#!/usr/bin/env python3
"""Minimal dependency-free .docx writer.

A .docx is a zip of OOXML parts. Building one by hand avoids installing
python-docx or pandoc, neither of which is present here.

Input: a markdown-ish source file (see parse()).  Output: a .docx that Word,
LibreOffice, Google Docs and the macOS/iOS previewers all open.

Supported source syntax
  # H1 / ## H2 / ### H3
  | a | b |            table row (a row of only ---- separators is a rule)
  - bullet
  plain paragraph
  blank line          paragraph break
Inline: **bold**, `code`
"""

import html
import re
import sys
import zipfile

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"""

RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""

# Korean text needs an East-Asian font hint (w:eastAsia) or Word falls back to
# a Latin face and the Hangul renders in a mismatched weight.
FONTS = ('<w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" '
         'w:eastAsia="Malgun Gothic" w:cs="Malgun Gothic"/>')
MONO = ('<w:rFonts w:ascii="D2Coding" w:hAnsi="D2Coding" '
        'w:eastAsia="D2Coding" w:cs="Consolas"/>')


def _heading(level, size, color, before):
    return (
        f'<w:style w:type="paragraph" w:styleId="Heading{level}">'
        f'<w:name w:val="heading {level}"/><w:basedOn w:val="Normal"/>'
        f'<w:pPr><w:keepNext/><w:spacing w:before="{before}" w:after="120"/>'
        f'<w:outlineLvl w:val="{level - 1}"/></w:pPr>'
        f'<w:rPr>{FONTS}<w:b/><w:color w:val="{color}"/>'
        f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr></w:style>'
    )


STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W}">
<w:docDefaults><w:rPrDefault><w:rPr>{FONTS}<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
{_heading(1, 36, '1A1A1A', 0)}
{_heading(2, 28, '1A1A1A', 360)}
{_heading(3, 22, '444444', 280)}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>
<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:hanging="180"/>
<w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>
<w:tblPr><w:tblBorders>
<w:top w:val="single" w:sz="4" w:color="C8C8C8"/><w:left w:val="single" w:sz="4" w:color="C8C8C8"/>
<w:bottom w:val="single" w:sz="4" w:color="C8C8C8"/><w:right w:val="single" w:sz="4" w:color="C8C8C8"/>
<w:insideH w:val="single" w:sz="4" w:color="C8C8C8"/><w:insideV w:val="single" w:sz="4" w:color="C8C8C8"/>
</w:tblBorders></w:tblPr></w:style>
</w:styles>"""


def esc(text):
    return html.escape(text, quote=False)


def runs(text):
    """Inline **bold** and `code` into a sequence of <w:r>."""
    out = []
    for part in re.split(r'(\*\*.+?\*\*|`[^`]+`)', text):
        if not part:
            continue
        if part.startswith('**') and part.endswith('**'):
            props, body = f'<w:rPr>{FONTS}<w:b/></w:rPr>', part[2:-2]
        elif part.startswith('`') and part.endswith('`'):
            props = f'<w:rPr>{MONO}<w:color w:val="B03030"/></w:rPr>'
            body = part[1:-1]
        else:
            props, body = '', part
        out.append(f'<w:r>{props}<w:t xml:space="preserve">{esc(body)}</w:t></w:r>')
    return ''.join(out) or '<w:r><w:t/></w:r>'


def para(text, style=None, shade=None):
    props = ''
    if style:
        props += f'<w:pStyle w:val="{style}"/>'
    if shade:
        props += f'<w:shd w:val="clear" w:fill="{shade}"/>'
    props = f'<w:pPr>{props}</w:pPr>' if props else ''
    return f'<w:p>{props}{runs(text)}</w:p>'


def table(rows):
    widths = [9360 // len(rows[0])] * len(rows[0])
    grid = ''.join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    body = []
    for index, row in enumerate(rows):
        header = index == 0
        cells = []
        for width, cell in zip(widths, row):
            shade = '<w:shd w:val="clear" w:fill="F2F2F2"/>' if header else ''
            text = f'**{cell}**' if header and not cell.startswith('**') else cell
            cells.append(
                f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{shade}'
                f'<w:vAlign w:val="center"/></w:tcPr>'
                f'<w:p><w:pPr><w:spacing w:after="40" w:before="40"/></w:pPr>'
                f'{runs(text)}</w:p></w:tc>'
            )
        repeat = '<w:trPr><w:tblHeader/></w:trPr>' if header else ''
        body.append(f'<w:tr>{repeat}{"".join(cells)}</w:tr>')
    return (
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>'
        '<w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/></w:tblPr>'
        f'<w:tblGrid>{grid}</w:tblGrid>{"".join(body)}</w:tbl><w:p/>'
    )


RULE = ('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" '
        'w:color="D0D0D0"/></w:pBdr><w:spacing w:before="240" w:after="240"/>'
        '</w:pPr></w:p>')


def parse(source):
    """Markdown-ish to OOXML.

    Soft-wrapped lines are joined into one paragraph.  Writing the source at a
    readable width would otherwise put every wrapped line in its own <w:p>,
    which both breaks the wrap point (the space is lost) and stops **bold**
    from matching across it.
    """
    blocks, rows, lines = [], [], []
    style = None

    def flush_table():
        if rows:
            blocks.append(table(rows.copy()))
            rows.clear()

    def flush_para():
        nonlocal style
        if lines:
            blocks.append(para(' '.join(lines), style))
            lines.clear()
        style = None

    for raw in source.splitlines():
        stripped = raw.rstrip()

        if stripped.startswith('|'):
            flush_para()
            cells = [c.strip() for c in stripped.strip('|').split('|')]
            if not all(set(c) <= {'-', ':'} and c for c in cells):
                rows.append(cells)
            continue
        flush_table()

        if not stripped:
            flush_para()
        elif set(stripped) == {'-'} and len(stripped) >= 3:
            flush_para()
            blocks.append(RULE)
        elif stripped.startswith(('# ', '## ', '### ')):
            flush_para()
            level = len(stripped) - len(stripped.lstrip('#'))
            blocks.append(para(stripped[level + 1:], f'Heading{level}'))
        elif stripped.startswith('- '):
            flush_para()
            style = 'ListParagraph'
            lines.append('• ' + stripped[2:])
        else:
            # Anything else continues the block above, wrap point restored.
            lines.append(stripped)
    flush_para()
    flush_table()
    return ''.join(blocks)


def build(source_path, out_path):
    with open(source_path, encoding='utf-8') as handle:
        body = parse(handle.read())
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W}"><w:body>{body}'
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>'
        '</w:sectPr></w:body></w:document>'
    )
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', CONTENT_TYPES)
        archive.writestr('_rels/.rels', RELS)
        archive.writestr('word/_rels/document.xml.rels', DOC_RELS)
        archive.writestr('word/styles.xml', STYLES)
        archive.writestr('word/document.xml', document)


if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2])
    print(f'wrote {sys.argv[2]}')
