declare module "jsmediatags/dist/jsmediatags.min.js" {
  const jsmediatags: {
    read: (
      file: Blob | File | string,
      opts: { onSuccess: (result: any) => void; onError: (error: any) => void },
    ) => void;
  };
  export default jsmediatags;
}