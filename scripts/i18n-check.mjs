import {readFileSync} from "node:fs";
const locales=["en","de","pl","fr","ru","uk","es","ar","it","nl"];
const expected=Object.keys(JSON.parse(readFileSync("messages/en.json","utf8"))).sort();
for (const locale of locales) {
 const dictionary=JSON.parse(readFileSync(`messages/${locale}.json`,"utf8"));
 if (JSON.stringify(Object.keys(dictionary).sort())!==JSON.stringify(expected)) throw new Error(`${locale}: dictionary keys differ`);
 for(const [key,value] of Object.entries(dictionary)) if(typeof value!=="string"||!value.trim()) throw new Error(`${locale}.${key}: empty translation`);
}
console.log(`PASS: ${locales.length} locales, ${expected.length} keys each. Human translation approval remains a launch gate.`);
