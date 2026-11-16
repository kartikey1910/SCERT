import { BeoPendingApplicationEditor } from './BeoPendingApplicationEditor.jsx';

export function BeoReturnedApplicationEditor({ applicationId, onBack }) {
  return <BeoPendingApplicationEditor applicationId={applicationId} onBack={onBack} />;
}
