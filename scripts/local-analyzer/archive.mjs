/** Only read a named, bounded DEFLATE entry as data; never extract archive paths. */
export function zipEntry(archive, target, expectedSize) {
  let eocd = archive.length - 22;
  while (eocd >= Math.max(0, archive.length - 65557) && archive.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0 || eocd < archive.length - 65557) throw new Error('Invalid ZIP directory');
  const count = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const size = archive.readUInt32LE(offset + 20), raw = archive.readUInt32LE(offset + 24);
    const length = archive.readUInt16LE(offset + 28), extra = archive.readUInt16LE(offset + 30), comment = archive.readUInt16LE(offset + 32);
    const name = archive.subarray(offset + 46, offset + 46 + length).toString('utf8');
    if (name === target) {
      if (archive.readUInt16LE(offset + 10) !== 8 || raw !== expectedSize) throw new Error('Unexpected dictionary entry');
      const local = archive.readUInt32LE(offset + 42);
      if (local + 30 > archive.length || archive.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid local ZIP header');
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      if (start + size > archive.length) throw new Error('Truncated ZIP entry');
      return archive.subarray(start, start + size);
    }
    offset += 46 + length + extra + comment;
  }
  throw new Error('Dictionary entry missing');
}
