import "./globals.css";
export const metadata = { title: "WASPS Sign-In", description: "Weekly event member sign-in" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
