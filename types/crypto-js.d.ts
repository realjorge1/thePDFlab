declare module "crypto-js/crypto-js" {
  export function MD5(message: string): { toString(): string };
  export function SHA256(message: string): { toString(): string };
  const CryptoJS: {
    MD5: typeof MD5;
    SHA256: typeof SHA256;
  };
  export default CryptoJS;
}
