Allocate-from-TryBooking update

1. In Supabase, open SQL Editor, paste the contents of 012_list_class_mappings.sql and click Run.
2. Copy these into the repository root, keeping the folder structure and replacing the existing files:
   - package.json (adds jspdf and jspdf-autotable)
   - app/admin/allocate-event/page.tsx (new)
   - components/EventAllocationApp.tsx (new)
   - components/EventImportApp.tsx (adds a link to the new page)
   - lib/event-allocation/ (new folder: rules.ts, types.ts, csv.ts, engine.ts, outputs.ts)
   - lib/event-import/parser.ts (fixes the text-date matching)
3. Commit to GitHub and let Vercel redeploy.
4. Open /admin/allocate-event as an admin or organiser.

Weekly use: choose the TryBooking CSV, check the event date, type the first WEID,
click Allocate, review, download the PDF and the four start lists, then click Import event.

Club rules (fixed bays, bay pools, assist-only and excluded members) are in
lib/event-allocation/rules.ts. Add Todd Dempsey's WASRA number to ASSIST_RO_ONLY_WASRA there.
