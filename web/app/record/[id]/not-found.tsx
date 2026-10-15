import { NotFoundMessage } from '@/components/not-found-message';

// A record ID that isn't in this snapshot. Without this file, notFound() from
// the record page escaped the layout, and the 404 only appeared once
// JavaScript ran.
export default function RecordNotFound() {
  return (
    <NotFoundMessage title="No record with this ID">
      This snapshot has no record with this ID. Check the link, or search for the paper by its title or DOI.
    </NotFoundMessage>
  );
}
