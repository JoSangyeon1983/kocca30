using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace OmtalPlay;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        string? verify = Argument(args, "--verify");
        string? dataRoot = verify is null ? null : Argument(args, "--data-root");
        using var form = new PlayerForm(verify, dataRoot);
        Application.Run(form);
    }

    private static string? Argument(string[] args, string name)
    {
        int index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? Path.GetFullPath(args[index + 1]) : null;
    }
}

internal sealed record BundleInfo(string PayloadSha256, string RuntimeVersion, string SourceSha256,
    Dictionary<string, string> WebFiles);

internal static class Bundle
{
    public static BundleInfo Info { get; } = JsonSerializer.Deserialize<BundleInfo>(Read("bundle.json"))!;
    private static Stream Read(string name) => Assembly.GetExecutingAssembly()
        .GetManifestResourceStream("OmtalPlay." + name) ?? throw new IOException("내장 파일이 없습니다: " + name);

    public static async Task<(string Folder, bool Extracted)> Prepare(string root, Action<string> progress)
    {
        Directory.CreateDirectory(root);
        string destination = Path.Combine(root, Info.PayloadSha256[..16]);
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        using FileStream gate = await Lock(Path.Combine(root, "prepare.lock"));
        string marker = Path.Combine(destination, "complete.txt");
        bool complete = File.Exists(marker) && await File.ReadAllTextAsync(marker) == Info.PayloadSha256
            && File.Exists(Path.Combine(destination, "runtime", "msedgewebview2.exe"))
            && File.Exists(Path.Combine(destination, "web", "극 진행 보기.html"));
        if (complete) return (destination, false);
        progress("첫 실행 준비 중입니다. 잠시 기다려 주세요.");
        string staging = Path.Combine(root, "prepare-" + Guid.NewGuid().ToString("N"));
        try
        {
            await Task.Run(() =>
            {
                using Stream archive = Read("payload.zip");
                string hash = Convert.ToHexString(SHA256.HashData(archive)).ToLowerInvariant();
                if (hash != Info.PayloadSha256) throw new IOException("내장 파일 검증에 실패했습니다.");
                archive.Position = 0;
                ZipFile.ExtractToDirectory(archive, staging);
                // Windows 10 Fixed Runtime requires these two app-container read/execute grants.
                if (Environment.OSVersion.Version.Build < 22000)
                {
                    var directory = new DirectoryInfo(Path.Combine(staging, "runtime"));
                    DirectorySecurity acl = directory.GetAccessControl();
                    foreach (string sid in new[] { "S-1-15-2-1", "S-1-15-2-2" })
                        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),
                            FileSystemRights.ReadAndExecute, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                            PropagationFlags.None, AccessControlType.Allow));
                    directory.SetAccessControl(acl);
                }
                File.WriteAllText(Path.Combine(staging, "complete.txt"), Info.PayloadSha256);
                // Only this application's exact hash-named cache is replaced after an interrupted extraction.
                if (Directory.Exists(destination)) Directory.Move(destination, destination + ".incomplete-" + Guid.NewGuid().ToString("N"));
                Directory.Move(staging, destination);
            });
            return (destination, true);
        }
        catch
        {
            // Preserve incomplete extraction for diagnosis; the next launch uses another staging folder.
            throw;
        }
    }

    private static async Task<FileStream> Lock(string path)
    {
        var watch = Stopwatch.StartNew();
        while (true)
        {
            try { return new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) when (watch.Elapsed < TimeSpan.FromMinutes(3)) { await Task.Delay(250); }
        }
    }
}

internal sealed class PlayerForm : Form
{
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(23, 19, 15) };
    private readonly ToolStripStatusLabel state = new() { Text = "실행 준비 중", Spring = true, TextAlign = ContentAlignment.MiddleLeft };
    private readonly Label loading = new() { Dock = DockStyle.Fill, Text = "실행 준비 중입니다.",
        ForeColor = Color.FromArgb(234, 217, 185), BackColor = Color.FromArgb(23, 19, 15),
        TextAlign = ContentAlignment.MiddleCenter, Font = new Font("맑은 고딕", 13) };
    private readonly string? verify;
    private readonly string root;
    private readonly List<string> scriptErrors = [];
    private readonly List<string> blockedRequests = [];
    private string bundleFolder = "";
    private bool extracted;
    private CoreWebView2Environment? engine;
    private FormBorderStyle priorBorder;
    private FormWindowState priorWindow;
    private Rectangle priorBounds;

    public PlayerForm(string? verify, string? dataRoot)
    {
        this.verify = verify;
        root = dataRoot ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Cellbig", "OmtalPlay");
        Text = "탈놀음 한바탕 - 옴탈잡이";
        AutoScaleMode = AutoScaleMode.Dpi;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1280, 960);
        MinimumSize = new Size(860, 640);
        BackColor = Color.FromArgb(23, 19, 15);
        var status = new StatusStrip { SizingGrip = false, BackColor = Color.FromArgb(35, 29, 23),
            ForeColor = Color.FromArgb(234, 217, 185) };
        status.Items.Add(state);
        Controls.Add(web);
        Controls.Add(loading);
        Controls.Add(status);
        loading.BringToFront();
        if (verify is not null) { ShowInTaskbar = false; Opacity = 0; }
        Shown += async (_, _) => await Initialize();
        FormClosed += (_, _) => web.Dispose();
    }

    private async Task Initialize()
    {
        try
        {
            (bundleFolder, extracted) = await Bundle.Prepare(root, message => { loading.Text = message; state.Text = message; });
            string arguments = "--disable-background-networking --disable-component-update --no-first-run";
            if (verify is not null) arguments += " --disable-gpu --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";
            var options = new CoreWebView2EnvironmentOptions(arguments);
            engine = await CoreWebView2Environment.CreateAsync(Path.Combine(bundleFolder, "runtime"), Path.Combine(root, "browser-data"), options);
            await web.EnsureCoreWebView2Async(engine);
            web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            web.CoreWebView2.SetVirtualHostNameToFolderMapping("omtal.local", Path.Combine(bundleFolder, "web"), CoreWebView2HostResourceAccessKind.DenyCors);
            web.CoreWebView2.NewWindowRequested += (_, e) => e.Handled = true;
            web.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            web.CoreWebView2.WebResourceRequested += (_, e) =>
            {
                if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out Uri? uri) && uri.Host == "omtal.local") return;
                blockedRequests.Add(e.Request.Uri);
                e.Response = engine.CreateWebResourceResponse(null, 403, "Offline content only", "");
            };
            web.CoreWebView2.WebMessageReceived += (_, e) => scriptErrors.Add(e.TryGetWebMessageAsString());
            await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("addEventListener('error', e => chrome.webview.postMessage(String(e.message)));addEventListener('unhandledrejection', e => chrome.webview.postMessage(String(e.reason)));");
            web.CoreWebView2.ContainsFullScreenElementChanged += (_, _) => SetFullScreen(web.CoreWebView2.ContainsFullScreenElement);
            web.CoreWebView2.NavigationCompleted += async (_, e) =>
            {
                if (!e.IsSuccess) { await Fail(new IOException("화면을 열지 못했습니다: " + e.WebErrorStatus)); return; }
                loading.Visible = false;
                state.Text = "Space 또는 Enter로 대사를 넘깁니다.";
                web.Focus();
                if (verify is not null) await Verify();
            };
            web.Source = new Uri("https://omtal.local/" + Uri.EscapeDataString("극 진행 보기.html"));
        }
        catch (Exception error) { await Fail(error); }
    }

    private void SetFullScreen(bool active)
    {
        if (active)
        {
            priorBorder = FormBorderStyle; priorWindow = WindowState; priorBounds = Bounds;
            WindowState = FormWindowState.Normal; FormBorderStyle = FormBorderStyle.None; WindowState = FormWindowState.Maximized;
        }
        else { WindowState = FormWindowState.Normal; FormBorderStyle = priorBorder; Bounds = priorBounds; WindowState = priorWindow; }
    }

    private async Task Fail(Exception error)
    {
        Environment.ExitCode = 1;
        if (verify is not null)
        {
            Directory.CreateDirectory(verify);
            await File.WriteAllTextAsync(Path.Combine(verify, "failure.txt"), error.ToString());
            Close();
        }
        else
        {
            loading.Text = "실행하지 못했습니다. 프로그램을 닫고 다시 실행해 주세요.";
            state.Text = "실행 오류";
            MessageBox.Show(this, error.Message, "옴탈잡이 실행 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task<T> Evaluate<T>(string expression)
    {
        string json = await web.CoreWebView2.ExecuteScriptAsync(expression);
        return JsonSerializer.Deserialize<T>(json)!;
    }
    private async Task PressControl(string id) => await web.CoreWebView2.ExecuteScriptAsync($"document.getElementById({JsonSerializer.Serialize(id)}).click()");
    private static void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }


    private async Task GoEvent(string expression)
    {
        await PressControl("restart");
        Check(await Evaluate<bool>("(()=>{const target=" + expression + ";for(let i=0;i<200;i++){if(document.getElementById('stage').dataset.eventId===target)return true;document.getElementById('next').click();}return false;})()"), "Event not reached: " + expression);
    }

    private async Task CheckEmptyDialogue()
    {
        Check(await Evaluate<bool>("(()=>{const e=document.getElementById('dialogue'),s=getComputedStyle(e);return e.classList.contains('is-hidden')&&s.display==='flex'&&s.visibility==='visible'&&s.opacity==='1'&&e.getBoundingClientRect().height>100&&getComputedStyle(e.firstElementChild).visibility==='hidden';})()"), "Empty dialogue frame disappeared");
    }

    private async Task Verify()
    {
        try
        {
            Directory.CreateDirectory(verify!);
            string browserPath = Process.GetProcessById((int)web.CoreWebView2.BrowserProcessId).MainModule!.FileName;
            Check(browserPath.StartsWith(Path.Combine(bundleFolder, "runtime") + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase), "Bundled Runtime not used");
            foreach (var (relative, expected) in Bundle.Info.WebFiles)
            {
                using var input = File.OpenRead(Path.Combine(bundleFolder, "web", relative));
                Check(Convert.ToHexString(SHA256.HashData(input)).Equals(expected, StringComparison.OrdinalIgnoreCase), "Web input changed: " + relative);
            }
            await Task.Delay(800);
            Check(await Evaluate<bool>("document.getElementById('load-error').hidden && Array.from(document.images).filter(i=>i.src).every(i=>i.complete&&i.naturalWidth>0)"), "Image load failure");
            await CheckEmptyDialogue();
            await PressControl("start"); await Task.Delay(1200);
            int before = await Evaluate<int>("document.getElementById('speech-text').textContent.length");
            await Task.Delay(120);
            int after = await Evaluate<int>("document.getElementById('speech-text').textContent.length");
            Check(before > 0 && after > before, "Typewriter did not advance");
            await PressControl("next"); await Task.Delay(300);
            await CapturePage("윈도우 앱 첫 대사.png");
            await PressControl("next"); await PressControl("previous"); await PressControl("next");
            Check(await Evaluate<int>("parseInt(document.getElementById('speech-count').textContent)") == 1, "Previous failed");
            foreach (string chapter in new[] { "start", "chase", "grab", "inspect", "drive", "ending" })
            {
                string id = JsonSerializer.Serialize(chapter);
                Check(await Evaluate<bool>("(()=>{const s=document.getElementById('chapter-select');s.value=" + id + ";s.dispatchEvent(new Event('change'));return document.getElementById('stage').dataset.eventId===window.PLAY_DATA.events[window.PLAY_DATA.chapters.find(c=>c.id===" + id + ").start].id;})()"), "Chapter jump failed: " + chapter);
            }
            foreach (string side in new[] { "left", "right" })
            {
                await GoEvent("window.PLAY_DATA.events.find(e=>e.effect.peek==='" + side + "').id");
                await Task.Delay(650); await CheckEmptyDialogue();
                Check(await Evaluate<bool>("(()=>{const e=document.getElementById('peek-" + side + "');return !e.hidden&&getComputedStyle(e).opacity==='1'&&e.querySelector('img').getAttribute('src')==='이미지/옴탈 서 있는 자세.png'&&getComputedStyle(e.querySelector('img')).clipPath==='none'&&document.getElementById('omtal').getAttribute('aria-hidden')==='true';})()"), "Full-image edge peek failed: " + side);
                await CapturePage("윈도우 앱 " + side + " 기웃거림.png");
                await PressControl("next");
                Check(await Evaluate<bool>("document.getElementById('peek-layer').hidden"), "Peek did not fully hide");
            }
            await GoEvent("window.PLAY_DATA.events.find(e=>e.kind==='stage'&&e.effect.demo==='chase').id");
            for (int phase = 0; phase < 5; phase++)
            {
                await CheckEmptyDialogue();
                for (int sample = 0; sample < 6; sample++)
                {
                    Check(await Evaluate<bool>("(()=>{const s=document.getElementById('stage'),r=s.getBoundingClientRect(),k=document.getElementById('kkeok').getBoundingClientRect(),o=document.getElementById('omtal'),b=o.getBoundingClientRect(),p=window.PLAY_DATA.events.find(e=>e.id===s.dataset.eventId).cast.omtal;return Math.abs((k.x+k.width/2-r.x)/r.width-.5)<.001&&Math.abs((b.x+b.width/2-r.x)/r.width-p.x/100)<.001&&getComputedStyle(o).opacity===(p.visible?'1':'0');})()"), "Chase crossed center or lost centered Kkeoksoe");
                    await Task.Delay(40);
                }
                if (phase == 0) await CapturePage("윈도우 앱 빈 대사창.png");
                if (phase < 4) await PressControl("next");
            }
            await GoEvent("window.PLAY_DATA.events.filter(e=>e.kind==='speech').sort((a,b)=>b.text.length-a.text.length)[0].id");
            await web.CoreWebView2.ExecuteScriptAsync("document.getElementById('speed').value='20';document.getElementById('speed').dispatchEvent(new Event('change'));");
            for (int i = 0; i < 120 && !await Evaluate<bool>("document.getElementById('text-scroll').scrollTop>0"); i++) await Task.Delay(40);
            Check(await Evaluate<bool>("document.getElementById('text-scroll').scrollTop>0 && document.getElementById('speech-text').textContent.length<Math.max(...window.PLAY_DATA.events.filter(e=>e.kind==='speech').map(e=>e.text.length))"), "Live long-speech scroll failed");
            await PressControl("next"); await Task.Delay(350);
            await CapturePage("윈도우 앱 긴 대사.png");
            await GoEvent("window.PLAY_DATA.events.find(e=>e.ordinal===11).id");
            await PressControl("auto"); await PressControl("next"); await Task.Delay(1500);
            Check(await Evaluate<bool>("document.getElementById('stage').dataset.eventId===window.PLAY_DATA.events[window.PLAY_DATA.events.findIndex(e=>e.ordinal===11)+1].id"), "Automatic progression failed");
            await PressControl("auto"); await PressControl("restart");
            Check(await Evaluate<bool>("(()=>{const seen=[];for(let i=0;i<200;i++){if(document.getElementById('next').disabled)break;if(!document.getElementById('dialogue').classList.contains('is-hidden')){if(document.getElementById('speech-state').textContent==='대사 중')document.getElementById('next').click();seen.push({speaker:document.getElementById('speaker').textContent,text:document.getElementById('speech-text').textContent,ordinal:parseInt(document.getElementById('speech-count').textContent)});}document.getElementById('next').click();}return JSON.stringify(seen)===JSON.stringify(window.PLAY_DATA.events.filter(e=>e.kind==='speech').map(e=>({speaker:e.speaker,text:e.text,ordinal:e.ordinal})))&&seen.length===35&&window.PLAY_DATA.events.length===65&&document.querySelector('#opening h2').textContent==='막이 내렸습니다';})()"), "35 speeches / 65 events / ending traversal failed");
            await CheckEmptyDialogue();
            Check(scriptErrors.Count == 0, "JavaScript errors: " + string.Join("; ", scriptErrors));
            var report = new { verifiedAt = DateTimeOffset.Now, success = true,
                windowTitle = Text, browserVersion = engine!.BrowserVersionString,
                browserPath, bundleFolder, extracted, payloadSha256 = Bundle.Info.PayloadSha256,
                sourceSha256 = Bundle.Info.SourceSha256, webFiles = Bundle.Info.WebFiles.Count,
                speeches = 35, events = 65, checks = new[] { "published single EXE startup", "bundled Fixed Runtime used",
                    "embedded web files hash match", "image loading", "live typewriter and scrolling",
                    "previous, six chapter jumps and auto mode", "empty dialogue frame remains visible before play, during silent staging and after ending",
                    "full uncut original image for left/right peeks", "Kkeoksoe centered; Omtal snaps left/right with hidden gaps and no center crossing",
                    "all 35 speeches and 65 events reach ending", "no JavaScript exceptions" },
                scriptErrors, blockedRequests };
            await File.WriteAllTextAsync(Path.Combine(verify!, "실행 검증.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
            Close();
        }
        catch (Exception error) { await Fail(error); }
    }

    private async Task CapturePage(string name)
    {
        using var stream = File.Create(Path.Combine(verify!, name));
        await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
    }
}
