import type { ReactNode } from "react";
import { AccountWalletBridge } from "@/components/account-wallet-bridge";

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AccountWalletBridge />
    </>
  );
}
