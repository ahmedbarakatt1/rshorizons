export type PublishedReview={
 id:string;rating:number;text:string;locale:string;display_name:string;submitted_at:string;
 replies:{body:string;publishedAt:string}[];
};
export type ReviewPage={
 items:PublishedReview[];
 summary:{total:number;average:number|null;ratings:Record<string,number>};
 filteredTotal:number;
 nextCursor:string|null;
};
