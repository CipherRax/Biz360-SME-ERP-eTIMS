import { redirect } from 'next/navigation';

export default function PurchasesIndexPage() {
  redirect('/purchases/purchase-orders');
}