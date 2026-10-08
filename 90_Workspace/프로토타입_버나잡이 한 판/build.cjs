const fs=require('node:fs'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
const html=read('index.html').replace('<link rel="stylesheet" href="style.css">',()=>'<style>\n'+read('style.css')+'\n</style>')
  .replace('<script src="physics.js"></script><script src="app.js"></script>',()=>'<script>\n'+read('physics.js')+'\n</script>\n<script>\n'+read('app.js')+'\n</script>');
fs.writeFileSync(path.join(__dirname,'버나잡이 한 판.html'),html,'utf8');
console.log('Built: 버나잡이 한 판.html ('+Buffer.byteLength(html)+' bytes)');
