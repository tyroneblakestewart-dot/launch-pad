import type { EIP1193Provider } from "viem";

declare module "viem" {
  export type Eip1193Provider = EIP1193Provider;
}
