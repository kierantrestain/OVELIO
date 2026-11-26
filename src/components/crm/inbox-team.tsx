'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { inboxTeamStatusLabels, inboxTeamStatuses } from '@/contracts/mailbox-team';
import type { InboxTeam, InboxTeamPatch, InboxTeamStatus, SavedReply } from '@/contracts/mailbox-team';
import { api, date, useAction, useResource } from '../client';
import { AsyncState, ConfirmDialog, Feedback, FormActions, Modal, Panel } from '../ui';

const savedRepliesPath = '/sales/inbox/saved-replies';
const statusOptions = inboxTeamStatuses.map(status => ({ value: status, label: inboxTeamStatusLabels[status] }));
type Location = { mailboxId: string; threadId: string; onChanged: () => void };

export function InboxTeamPanel({ mailboxId, threadId, onChanged }: Location) {
  return <TeamPanel key={JSON.stringify([mailboxId, threadId])} mailboxId={mailboxId} threadId={threadId} onChanged={onChanged} />;
}

function TeamPanel({ mailboxId, threadId, onChanged }: Location) {
  const query = new URLSearchParams({ mailboxId, threadId }).toString();
  const path = `/sales/inbox/team?${query}`;
  const resource = useResource<InboxTeam>(path);
  const action = useAction();
  const [note, setNote] = useState('');
  const team = resource.data;
  const update = (input: InboxTeamPatch) => void action.run(async () => {
    await api<InboxTeam>(path, 'PATCH', input);
    resource.refresh();
    onChanged();
  }, 'Conversation updated.');

  return <Panel title="Team inbox">
    <AsyncState loading={resource.loading && !team} error={resource.error} retry={resource.refresh} />
    {team ? <div className="ov-stack-sm">
      <div className="ov-form-grid">
        {team.canChangeStatus
          ? <Selector label="Conversation status" value={team.status} options={statusOptions} isDisabled={action.busy || resource.loading}
            onChange={value => { if (value && value !== team.status) update({ status: value as InboxTeamStatus }); }} />
          : <Text type="supporting">Status · {inboxTeamStatusLabels[team.status]}</Text>}
        {team.canAssign
          ? <Selector label="Assigned to" value={team.assignee?.id ?? 'unassigned'}
            options={[{ value: 'unassigned', label: 'Unassigned' }, ...team.assignmentOptions.map(member => ({ value: member.id, label: member.name }))]}
            isDisabled={action.busy || resource.loading}
            onChange={value => update({ assigneeId: !value || value === 'unassigned' ? null : value })} />
          : <Text type="supporting">Assigned to · {team.assignee?.name ?? 'Unassigned'}</Text>}
      </div>
      {team.notes.length ? <ul aria-label="Internal notes" className="ov-rows">
        {team.notes.map(item => <li key={item.id} style={{ display: 'block' }}>
          <div className="ov-stack-sm">
            <Text type="supporting" color="secondary">{item.authorName} · {date(item.createdAt)}</Text>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.body}</div>
          </div>
        </li>)}
      </ul> : null}
      <form className="ov-stack-sm" onSubmit={event => {
        event.preventDefault();
        void action.run(async () => {
          await api(`/sales/inbox/notes?${query}`, 'POST', { body: note });
          setNote('');
          resource.refresh();
        }, 'Internal note added.');
      }}>
        <TextArea label="Internal note" description="Visible to people with access to this mailbox." value={note} onChange={setNote} />
        <FormActions>
          <Button type="submit" label="Add note" size="sm" isLoading={action.busy} isDisabled={!note.trim() || note.length > 4000} />
        </FormActions>
      </form>
      <Feedback error={action.error} />
    </div> : null}
  </Panel>;
}

export function SavedReplyPicker({ onApply }: { onApply: (text: string) => void }) {
  const replies = useResource<{ items: SavedReply[] }>(savedRepliesPath);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedReply | 'new' | null>(null);
  const items = replies.data?.items ?? [];
  const selected = items.find(item => item.id === selectedId);

  return <div className="ov-stack-sm">
    <Selector label="Saved reply" placeholder="Choose a saved reply" value={selected?.id ?? null} onChange={setSelectedId}
      options={items.map(item => ({ value: item.id, label: item.title }))} isLoading={replies.loading} hasClear />
    <div className="ov-actions">
      <Button label="Insert reply" size="sm" isDisabled={!selected} onClick={() => { if (selected) onApply(selected.body); }} />
      <Button label="New saved reply" size="sm" onClick={() => setEditing('new')} />
      {selected ? <Button label="Edit saved reply" size="sm" onClick={() => setEditing(selected)} /> : null}
    </div>
    <AsyncState loading={false} error={replies.error} retry={replies.refresh} />
    {editing ? <SavedReplyEditor item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)}
      onSaved={reply => {
        setSelectedId(reply?.id ?? null);
        replies.refresh();
        setEditing(null);
      }} /> : null}
  </div>;
}

function SavedReplyEditor({ item, onClose, onSaved }: {
  item?: SavedReply;
  onClose: () => void;
  onSaved: (reply?: SavedReply) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const action = useAction();
  const path = item ? `${savedRepliesPath}/${item.id}` : savedRepliesPath;

  return <>
    <Modal title={item ? 'Edit saved reply' : 'New saved reply'} onClose={onClose}>
      <form className="ov-stack-sm" onSubmit={event => {
        event.preventDefault();
        void action.run(async () => onSaved(await api<SavedReply>(path, item ? 'PATCH' : 'POST', { title, body })), 'Saved reply updated.');
      }}>
        <TextInput label="Reply name" value={title} onChange={setTitle} isRequired />
        <TextArea label="Reply text" value={body} onChange={setBody} isRequired />
        <Feedback error={action.error} />
        <FormActions>
          {item ? <Button label="Delete reply" onClick={() => setConfirmDelete(true)} /> : null}
          <Button label="Cancel" onClick={onClose} />
          <Button type="submit" variant="primary" label="Save reply" isLoading={action.busy}
            isDisabled={!title.trim() || title.length > 100 || !body.trim() || body.length > 5000} />
        </FormActions>
      </form>
    </Modal>
    {confirmDelete && item ? <ConfirmDialog title="Delete saved reply?" description={`Remove “${item.title}” from your saved replies.`}
      actionLabel="Delete reply" busy={action.busy} onClose={() => setConfirmDelete(false)}
      onConfirm={() => void action.run(async () => {
        await api(path, 'DELETE');
        onSaved();
      }, 'Saved reply deleted.')} /> : null}
  </>;
}
