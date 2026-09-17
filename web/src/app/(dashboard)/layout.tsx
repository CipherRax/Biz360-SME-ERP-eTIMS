import { DashboardGate } from '@/components/layout/dashboard-gate';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardGate>{children}</DashboardGate>;
}