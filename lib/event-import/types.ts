export type ImportEntry={source_booking_id:string;source_ticket_number:string;weid:string;wasra_number:number;first_name:string;surname:string;target_type:"E"|"P";distance:string;shooting_class:string;position:string;fkcid:number;mcid:number;championship_score_eligible:boolean;volunteer_preference:string;sharing_with:string;d1:number|null;d2:number|null;d3:number|null;d4:number|null};
export type ImportVolunteer={role:string;detail_number:number;member_name:string};
export type ValidationIssue={severity:"error"|"warning";row?:number;message:string};
export type ImportPreview={eventDate:string;entries:ImportEntry[];volunteers:ImportVolunteer[];issues:ValidationIssue[];bayCount:number};
