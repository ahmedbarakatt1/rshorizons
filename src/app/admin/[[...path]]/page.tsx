import {AdminApp} from "@/components/AdminApp";
export const dynamic="force-dynamic";
export default async function AdminPage({params,searchParams}:{params:Promise<{path?:string[]}>;searchParams:Promise<{lang?:string|string[]}>}) {
 const [{path=[]},{lang}]=await Promise.all([params,searchParams]);
 return <AdminApp path={path} locale={lang==="ar"?"ar":"en"} demo={process.env.DEMO_MODE==="true"&&process.env.APP_ENV!=="production"}/>;
}
