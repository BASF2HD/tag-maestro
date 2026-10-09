type WritableHandle = FileSystemFileHandle & {
  createWritable: () => Promise<FileSystemWritableFileStream>;
};

async function digest(blob: Blob) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
}

/** Do not report success until a newly opened disk file matches every output byte. */
export async function writeVerifiedFile(handle: WritableHandle, blob: Blob): Promise<File> {
  const expected = await digest(blob);
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  const saved = await handle.getFile();
  const actual = await digest(saved);
  if (saved.size !== blob.size || expected.some((byte, index) => byte !== actual[index])) {
    throw new Error(
      `Read-back verification failed for ${saved.name}. The file was not marked saved; check the disk before retrying.`,
    );
  }
  return saved;
}
