import type {Metadata} from "next";
export const metadata:Metadata={title:"Operations · Red Sea Horizons",robots:{index:false,follow:false}};
export default function AdminLayout({children}:{children:React.ReactNode}){return <div dir="ltr" lang="en">{children}</div>;}
