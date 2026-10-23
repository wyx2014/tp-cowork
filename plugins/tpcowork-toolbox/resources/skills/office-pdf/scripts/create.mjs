import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
function pdfText(value) {
  const bytes = Buffer.from(String(value), "utf16le");
  return bytes.swap16().toString("hex").toUpperCase();
}
export async function createDocument(output, data) {
  if (!data || !Array.isArray(data.paragraphs) || data.paragraphs.some(value => typeof value !== "string")
    || (data.title !== undefined && typeof data.title !== "string")) throw new Error("Expected title (string) and paragraphs (array of strings)");
  if ([data.title ?? "", ...data.paragraphs].some(text => /[\u{10000}-\u{10FFFF}]/u.test(text)))
    throw new Error("This text starter does not support emoji or supplementary Unicode characters; use the Office-to-PDF workflow instead");
  const lines = [data.title ?? "", ...data.paragraphs].flatMap((text) =>
    String(text)
      .split(/\r?\n/)
      .flatMap((line) => line.match(/.{1,40}/gu) ?? [""]),
  );
  const pages = [];
  for (let i = 0; i < lines.length; i += 38) pages.push(lines.slice(i, i + 38));
  const objects = [
    "",
    "",
    "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 5 0 R /DW 1000 >>",
    "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>",
  ];
  const mapping = `/CIDInit /ProcSet findresource begin
12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Identity-UCS def /CMapType 2 def
1 begincodespacerange <0000> <FFFF> endcodespacerange
1 beginbfrange <0000> <FFFF> <0000> endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end`;
  objects.push(`<< /Length ${Buffer.byteLength(mapping)} >>\nstream\n${mapping}\nendstream`);
  const ids = [];
  for (const lines of pages) {
    const id = objects.length + 1;
    ids.push(id);
    const stream = `BT /F1 12 Tf 20 TL 50 790 Td ${lines.map((line, i) => `${i ? "T* " : ""}<${pdfText(line)}> Tj`).join("\n")} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Count ${ids.length} /Kids [${ids.map((id) => `${id} 0 R`).join(" ")}] >>`;
  const buffers = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  let length = buffers[0].length;
  objects.forEach((object, i) => {
    offsets.push(length);
    const bytes = Buffer.from(`${i + 1} 0 obj\n${object}\nendobj\n`);
    buffers.push(bytes);
    length += bytes.length;
  });
  buffers.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, Buffer.concat(buffers), { flag: "wx" });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error("Usage: node create.mjs input.json output.pdf");
  await createDocument(process.argv[3], JSON.parse(await readFile(process.argv[2], "utf8")));
}
