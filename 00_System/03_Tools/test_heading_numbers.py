"""Run with: python 00_System/03_Tools/test_heading_numbers.py"""

import contextlib
import io
import os
from pathlib import Path
import tempfile
import unittest

import heading_numbers as hn


class HeadingNumbersTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()

    def document(self, text, relative="note.md"):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
        return hn.parse(path, text, self.root)

    def cli(self, *arguments):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            try:
                result = hn.main([*arguments, "--root", str(self.root)])
            except SystemExit as error:
                result = error.code
        return result, output.getvalue()

    def test_all_five_levels_and_parent_resets(self):
        doc = self.document("# A\n## B\n### C\n#### D\n##### E\n##### F\n#### G\n### H\n#### I\n## J\n### K\n# L\n## M\n")
        result, errors = hn.numbered(doc, "unnumbered")
        self.assertFalse(errors)
        self.assertEqual(result, "# 1 A\n## 1.1 B\n### 1.1.1 C\n#### 1) D\n##### (1) E\n##### (2) F\n#### 2) G\n### 1.1.2 H\n#### 1) I\n## 1.2 J\n### 1.2.1 K\n# 2 L\n## 2.1 M\n")

    def test_renumber_existing_and_new_plain_heading(self):
        doc = self.document("# 4 A\n## 4.2 B\n## Added\n# 8 C\n")
        result, errors = hn.numbered(doc, "numbered")
        self.assertFalse(errors)
        self.assertEqual(result, "# 1 A\n## 1.1 B\n## 1.2 Added\n# 2 C\n")

    def test_repeated_application_is_idempotent(self):
        doc = self.document("# A\n## B\n### C\n#### D\n##### E\n")
        first, _ = hn.numbered(doc, "unnumbered")
        second, errors = hn.numbered(self.document(first), "numbered")
        self.assertFalse(errors)
        self.assertEqual(first, second)

    def test_numeric_title_preserved_on_first_application(self):
        result, errors = hn.numbered(self.document("# 2026 계획\n"), "unnumbered")
        self.assertFalse(errors)
        self.assertEqual(result, "# 1 2026 계획\n")
        again, _ = hn.numbered(self.document(result), "numbered")
        self.assertEqual(again, result)

    def test_literal_line_protects_new_numeric_title(self):
        result, _ = hn.numbered(self.document("# 1 Existing\n# 2026 계획\n"), "numbered", {2})
        self.assertEqual(result, "# 1 Existing\n# 2 2026 계획\n")

    def test_frontmatter_and_code_examples_remain_unchanged(self):
        prefix = '---\ntitle: Example\ndescription: |\n  # Preserve YAML\n---\n```md\n# Example\n```\n~~~\n## More examples\n~~~\n    # Indented code\n> # Quoted heading\n- # List heading\n'
        result, errors = hn.numbered(self.document(prefix + "# Real\n"), "unnumbered")
        self.assertFalse(errors)
        self.assertEqual(result, prefix + "# 1 Real\n")

    def test_shorter_inner_fence_does_not_close_outer_fence(self):
        prefix = "````md\n# Example\n```\n# Still code\n````\n"
        result, errors = hn.numbered(self.document(prefix + "# Real\n"), "unnumbered")
        self.assertFalse(errors)
        self.assertEqual(result, prefix + "# 1 Real\n")

    def test_raw_html_and_comments_preserved(self):
        prefix = "<!--\n# Comment\n-->\n<pre>\n# Raw HTML\n</pre>\n"
        result, errors = hn.numbered(self.document(prefix + "# Real\n"), "unnumbered")
        self.assertFalse(errors)
        self.assertEqual(result, prefix + "# 1 Real\n")

    def test_bom_crlf_and_closing_hashes_preserved(self):
        original = '\ufeff---\r\ntitle: Test\r\n---\r\n# A ##  \r\n## B\r\n'
        expected = original.replace("# A", "# 1 A").replace("## B", "## 1.1 B")
        actual, errors = hn.numbered(self.document(original), "unnumbered")
        self.assertFalse(errors)
        self.assertEqual(actual, expected)

    def test_skipped_parent_not_automatically_changed(self):
        original = "# A\n### C\n"
        actual, errors = hn.numbered(self.document(original), "unnumbered")
        self.assertEqual(actual, original)
        self.assertIn("HIERARCHY", [issue.code for issue in errors])

    def test_first_heading_requires_h1(self):
        _, errors = hn.numbered(self.document("## A\n"), "unnumbered")
        self.assertIn("HIERARCHY", [issue.code for issue in errors])

    def test_empty_heading_reported(self):
        _, errors = hn.numbered(self.document("# ###\n"), "unnumbered")
        self.assertIn("EMPTY", [issue.code for issue in errors])

    def test_h6_reported(self):
        _, errors = hn.numbered(self.document("# A\n###### B\n"), "unnumbered")
        self.assertIn("LEVEL", [issue.code for issue in errors])

    def test_unclosed_fence_reported(self):
        _, errors = hn.numbered(self.document("# A\n```\n# Code\n"), "unnumbered")
        self.assertIn("FENCE", [issue.code for issue in errors])

    def test_setext_reported(self):
        _, errors = hn.numbered(self.document("Heading\n=======\n"), "unnumbered")
        self.assertIn("SETEXT", [issue.code for issue in errors])

    def test_log_folder_excluded_even_with_invalid_headers(self):
        doc = self.document("###### No numbering\n", "00_System/02_Logs/2026-10.md")
        actual, errors = hn.numbered(doc, "unnumbered")
        self.assertEqual(actual, doc.text)
        self.assertFalse(errors)

    def test_log_metadata_excluded_outside_log_folder(self):
        text = '---\ntype: "log"\n---\n# 2026-10-07 — Event\n'
        actual, errors = hn.numbered(self.document(text), "unnumbered")
        self.assertEqual(actual, text)
        self.assertFalse(errors)

    def test_nested_type_metadata_does_not_exclude_document(self):
        self.assertFalse(self.document("---\nsettings:\n  type: log\n---\n# A\n").is_log)

    def test_check_detects_missing_and_wrong_numbers(self):
        _, errors = hn.numbered(self.document("# A\n## 1.4 B\n"), "check")
        self.assertEqual([issue.code for issue in errors], ["NUMBER", "NUMBER"])

    def test_batch_with_structure_error_writes_nothing(self):
        first = self.document("# A\n", "a.md")
        second = self.document("### B\n", "b.md")
        code, _ = self.cli("apply", "a.md", "b.md", "--input", "unnumbered")
        self.assertEqual(code, 1)
        self.assertEqual(first.path.read_text(), first.text)
        self.assertEqual(second.path.read_text(), second.text)

    def test_apply_updates_only_frontmatter_date_and_is_repeatable(self):
        doc = self.document('---\ntitle: Test\nupdated: "2020-01-01"\n---\n# A\n```yaml\nupdated: "PRESERVE"\n```\n')
        code, _ = self.cli("apply", "note.md", "--input", "unnumbered", "--date", "2026-10-07")
        self.assertEqual(code, 0)
        first = doc.path.read_bytes()
        self.assertIn(b'updated: "2026-10-07"', first)
        self.assertIn(b'updated: "PRESERVE"', first)
        code, _ = self.cli("apply", "note.md", "--input", "numbered", "--date", "2026-10-08")
        self.assertEqual(code, 0)
        self.assertEqual(doc.path.read_bytes(), first)

    def test_missing_frontmatter_date_does_not_change_code_example(self):
        doc = self.document('---\ntitle: Test\n---\n# A\n```yaml\nupdated: "PRESERVE"\n```\n')
        self.cli("apply", "note.md", "--input", "unnumbered", "--date", "2026-10-07")
        self.assertIn('updated: "PRESERVE"', doc.path.read_text())

    def test_apply_requires_explicit_input_mode(self):
        doc = self.document("# 2026 계획\n")
        code, _ = self.cli("apply", "note.md")
        self.assertEqual(code, 2)
        self.assertEqual(doc.path.read_text(), doc.text)

    def test_heading_links_that_would_break_block_apply(self):
        doc = self.document("# Old\n", "target.md")
        self.document("# 1 References\n[[target#Old]]\n", "source.md")
        code, output = self.cli("apply", "target.md", "--input", "unnumbered")
        self.assertEqual(code, 1)
        self.assertIn("HEADING_LINK", output)
        self.assertEqual(doc.path.read_text(), doc.text)

    def test_links_updated_to_future_heading_allow_apply(self):
        self.document("# Old\n", "target.md")
        self.document("# 1 References\n[[target#1 Old]]\n", "source.md")
        code, _ = self.cli("apply", "target.md", "--input", "unnumbered")
        self.assertEqual(code, 0)
        self.assertEqual(self.cli("check")[0], 0)

    def test_encoded_markdown_and_self_heading_links(self):
        self.document("# 1 Main\n## 1.1 Child\n[[#1.1 Child]]\n[Child](note.md#1.1%20Child)\n[Child](note.md#11-child)\n")
        self.assertEqual(self.cli("check")[0], 0)

    def test_duplicate_heading_links_reported(self):
        self.document("# 1 A\n## 1.1 B\n### 1.1.1 C\n#### 1) Same\n### 1.1.2 D\n#### 1) Same\n[[#1) Same]]\n")
        code, output = self.cli("check")
        self.assertEqual(code, 1)
        self.assertIn("HEADING_LINK", output)

    def test_code_examples_urls_and_block_links_are_not_heading_links(self):
        self.document("# 1 Main\n`[[missing#No]]`\n[Web](https://example.com/#No)\n[[note#^stable-id]]\n````\n[[missing#No]]\n````\n")
        self.assertEqual(self.cli("check")[0], 0)

    def test_link_destination_with_parentheses(self):
        self.assertEqual(hn.links("[Item](note.md#part(1))"), ["note.md#part(1)"])
        self.assertEqual(hn.links("[Item](<note.md#1) Title>)"), ["note.md#1) Title"])

    @unittest.skipUnless(hasattr(os, "setxattr"), "Extended attributes are unavailable")
    def test_atomic_write_preserves_metadata(self):
        doc = self.document("# A\n")
        os.setxattr(doc.path, "user.wiki-test", b"identity")
        self.assertEqual(self.cli("apply", "note.md", "--input", "unnumbered")[0], 0)
        self.assertEqual(os.getxattr(doc.path, "user.wiki-test"), b"identity")


if __name__ == "__main__":
    unittest.main()
