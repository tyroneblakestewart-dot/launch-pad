import type { Metadata } from "next";
import { SupportHub } from "@/components/support-hub";

export const metadata: Metadata = {
  title: "Support | HOODLUMS",
  description: "Report a problem to the HOODLUMS team.",
};

export default function SupportPage() {
  return <SupportHub />;
}
