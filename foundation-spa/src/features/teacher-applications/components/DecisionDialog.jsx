import { useId, useState } from 'react';
import { Button, Modal, Textarea } from '../../../components/ui/index.js';
import { MESSAGE_MAX, REVIEW_ACTIONS } from '../lib/reviewApi.js';

export default function DecisionDialog({ action, application, busy, error, onCancel, onConfirm }) {
  const [message, setMessage] = useState('');
  const fieldId = useId();
  const isReject = action === REVIEW_ACTIONS.REJECT;
  const trimmed = message.trim();
  const problem = !trimmed
    ? 'Enter a message to continue.'
    : trimmed.length > MESSAGE_MAX
      ? `Use ${MESSAGE_MAX} characters or fewer.`
      : '';

  const title = isReject ? 'Reject application' : 'Request more information';
  const explanation = isReject
    ? 'This marks the application as rejected. The applicant receives a generic email that does not include your reason.'
    : 'This asks the applicant to update their application. Your message is shown to them in their portal and is not included in the email.';

  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            variant={isReject ? 'danger' : 'primary'}
            onClick={() => onConfirm(trimmed)}
            disabled={busy || problem !== ''}
          >
            {busy ? 'Recording…' : isReject ? 'Confirm rejection' : 'Send request'}
          </Button>
        </>
      }
    >
      <div className="ta-dialog">
        <p>{explanation}</p>
        <p className="ta-muted ta-wrap">
          {application.full_name} · version {application.version}
        </p>
        <label htmlFor={fieldId} className="ta-label">
          {isReject ? 'Internal reason (never shown to the applicant)' : 'Message to the applicant'}
        </label>
        <Textarea
          id={fieldId}
          rows={5}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          aria-invalid={problem ? 'true' : 'false'}
          aria-describedby={`${fieldId}-hint`}
        />
        <p id={`${fieldId}-hint`} className={problem ? 'ta-error' : 'ta-muted'}>
          {problem || `${trimmed.length} of ${MESSAGE_MAX} characters`}
        </p>
        {error && <p role="alert" className="ta-error">{error}</p>}
      </div>
    </Modal>
  );
}
