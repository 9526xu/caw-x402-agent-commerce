const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function normalizeEvmAddress(address: string): string {
  if (!EVM_ADDRESS_PATTERN.test(address)) {
    throw new Error("address must be a 20-byte EVM address");
  }
  return address.toLowerCase();
}
