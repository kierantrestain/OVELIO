'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import type { MailboxRoutingSettings } from '@/contracts/mailbox-routing';
import { api, useAction, useResource } from '../client';
import { AsyncState, Feedback, FormActions, Modal } from '../ui';

export function MailboxRouting({ mailboxId }: { mailboxId: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button label="Routing" size="sm" onClick={() => setOpen(true)} />
    {open ? <RoutingDialog mailboxId={mailboxId} onClose={() => setOpen(false)} /> : null}
  </>;
}

function RoutingDialog({ mailboxId, onClose }: { mailboxId: string; onClose: () => void }) {
  const path = `/mailboxes/${mailboxId}/routing`;
  const current = useResource<MailboxRoutingSettings>(path);
  const action = useAction();
  const [choice, setChoice] = useState<string>();
  const settings = current.data;
  return <Modal title="Mailbox routing" onClose={onClose}>
    <AsyncState loading={current.loading && !settings} error={current.error} retry={current.refresh} />
    {settings ? <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      if (!choice) return;
      void action.run(async () => {
        await api(path, 'PATCH', { assigneeId: choice === 'unassigned' ? null : choice });
        onClose();
      }, 'Mailbox routing updated.');
    }}>
      <Selector label="Default assignee" value={choice ?? settings.assigneeId ?? 'unassigned'}
        description="Assigns new incoming conversations to this teammate."
        options={[{ value: 'unassigned', label: 'Unassigned' }, ...settings.assignmentOptions.map(item => ({ value: item.id, label: item.name }))]}
        onChange={value => setChoice(value ?? 'unassigned')} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label="Save routing" isLoading={action.busy} isDisabled={choice === undefined} />
      </FormActions>
    </form> : null}
  </Modal>;
}
