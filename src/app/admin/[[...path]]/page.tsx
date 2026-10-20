import {AdminApp} from "@/components/AdminApp";
export const dynamic="force-dynamic";
export default async function AdminPage({params}:{params:Promise<{path?:string[]}>}) {
 const {path=[]}=await params;
 return <AdminApp path={path} demo={process.env.DEMO_MODE==="true"&&process.env.APP_ENV!=="production"}/>;
}
