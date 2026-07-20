import { Banknote, CreditCard, Wallet2 } from "lucide-react";

export function PaymentMethodIcon({ method, className }: { method: string; className?: string }) {
  const Icon = method === "cash" ? Banknote : method === "mobile" ? CreditCard : Wallet2;
  return <Icon className={className ?? "size-3.5 shrink-0"} />;
}
