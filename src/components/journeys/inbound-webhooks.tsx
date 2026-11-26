'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { InboundHook, InboundHookSettings } from '@/contracts/journeys';
import { api, date, useAction, useResource } from '../client';
import { AsyncState, ConfirmDialog, Empty, Feedback, FormActions, Modal, Panel, Snippet, StatusBadge } from '../ui';

const endpoint = '/journeys/hooks';
const defaults: InboundHookSettings = {
  name: '', emailPath: 'email', firstNamePath: '', lastNamePath: '', amountPath: '', currencyPath: '', tags: [], active: true,
};
const mappings = [
  ['emailPath', 'Email path', 'customer.email'], ['firstNamePath', 'First name path', 'customer.first_name'],
  ['lastNamePath', 'Last name path', 'customer.last_name'], ['amountPath', 'Amount path', 'order.total'],
  ['currencyPath', 'Currency path', 'order.currency'],
] as const;

function HookEditor({ hook, close, saved }: { hook?: InboundHook; close: () => void; saved: (hook: InboundHook) => void }) {
  const [draft, setDraft] = useState(() => {
    const fields = hook ?? defaults;
    return {
      name: fields.name, emailPath: fields.emailPath, firstNamePath: fields.firstNamePath, lastNamePath: fields.lastNamePath,
      amountPath: fields.amountPath, currencyPath: fields.currencyPath, active: fields.active,
    };
  });
  const [tags, setTags] = useState(hook?.tags.join(', ') ?? '');
  const action = useAction();
  return <Modal title={hook ? 'Edit inbound webhook' : 'New inbound webhook'} onClose={close}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => saved(await api<InboundHook>(hook ? `${endpoint}/${hook.id}` : endpoint,
        hook ? 'PATCH' : 'POST', { ...draft, tags: tags.split(',').map(value => value.trim()).filter(Boolean) })));
    }}>
      <TextInput label="Webhook name" isRequired value={draft.name} onChange={name => setDraft(current => ({ ...current, name }))} />
      <Text type="supporting" color="secondary">Use dot paths to map fields from the incoming JSON.</Text>
      <div className="ov-form-grid">
        {mappings.map(([field, label, placeholder]) => <TextInput key={field} label={label} placeholder={placeholder}
          isRequired={field === 'emailPath'} value={draft[field]} onChange={value => setDraft(current => ({ ...current, [field]: value }))} />)}
        <TextInput label="Contact tags" placeholder="Separate tags with commas" value={tags} onChange={setTags} />
      </div>
      <Switch label="Accept deliveries" value={draft.active} onChange={active => setDraft(current => ({ ...current, active }))} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={close} />
        <Button label="Save webhook" type="submit" variant="primary" isLoading={action.busy} isDisabled={!draft.name.trim() || !draft.emailPath.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function HookConnection({ hook, close }: { hook: InboundHook; close: () => void }) {
  const [showSecret, setShowSecret] = useState(false);
  const deliveries = useResource<{ items: { deliveryKey: string; outcome: string; receivedAt: string }[] }>(`${endpoint}/${hook.id}/deliveries`);
  return <Modal title={hook.name} onClose={close}>
    <div className="ov-stack-sm">
      <Text>Send a JSON POST to this URL.</Text>
      <Snippet code={hook.url} language="text" />
      <Text type="supporting" color="secondary">Supply the shared secret as a Bearer token or use it to sign the request body with HMAC-SHA256.</Text>
      {showSecret ? <Snippet code={hook.secret} language="text" />
        : <div><Button size="sm" label="Reveal secret" onClick={() => setShowSecret(true)} /></div>}
      <Text weight="semibold">Recent deliveries</Text>
      {!deliveries.data ? <AsyncState loading={deliveries.loading} error={deliveries.error} retry={deliveries.refresh} />
        : deliveries.data.items.length ? <ul className="ov-rows">{deliveries.data.items.slice(0, 12).map(item =>
          <li key={item.deliveryKey}><Text>{item.outcome || 'Pending retry'}</Text><Text type="supporting">{date(item.receivedAt)}</Text></li>)}</ul>
          : <Text type="supporting" color="secondary">No deliveries yet.</Text>}
    </div>
  </Modal>;
}

export function InboundWebhooks() {
  const hooks = useResource<{ items: InboundHook[] }>(endpoint);
  const action = useAction();
  const [editing, setEditing] = useState<InboundHook | 'new' | null>(null);
  const [connection, setConnection] = useState<InboundHook | null>(null);
  const [rotating, setRotating] = useState<InboundHook | null>(null);
  return <Panel title="Inbound webhooks" description="Accept signed JSON from external tools and start OVELIO workflows."
    action={<Button size="sm" label="New inbound webhook" onClick={() => setEditing('new')} />}>
    <Feedback error={action.error} />
    {!hooks.data ? <AsyncState loading={hooks.loading} error={hooks.error} retry={hooks.refresh} />
      : hooks.data.items.length ? <ul className="ov-rows">
        {hooks.data.items.map(hook => <li key={hook.id}>
          <span className="ov-stack-sm">
            <span className="ov-actions"><Text weight="semibold">{hook.name}</Text>
              <StatusBadge label={hook.active ? 'Active' : 'Paused'} tone={hook.active ? 'success' : 'neutral'} /></span>
            <Text type="supporting" color="secondary">{hook.receivedCount} accepted · {hook.rejectedCount} refused</Text>
            {hook.lastError ? <Text type="supporting" color="secondary">{hook.lastError}</Text> : null}
          </span>
          <span className="ov-actions">
            <Button size="sm" label="Connection details" onClick={() => setConnection(hook)} />
            <Button size="sm" variant="ghost" label="Edit inbound webhook" onClick={() => setEditing(hook)} />
            <Button size="sm" variant="ghost" label="Rotate secret" onClick={() => setRotating(hook)} />
          </span>
        </li>)}
      </ul> : <Empty title="No inbound webhooks" description="Create one to receive events from an integration." />}
    {editing ? <HookEditor hook={editing === 'new' ? undefined : editing} close={() => setEditing(null)} saved={hook => {
      if (editing === 'new') setConnection(hook);
      setEditing(null);
      hooks.refresh();
    }} /> : null}
    {connection ? <HookConnection hook={connection} close={() => setConnection(null)} /> : null}
    {rotating ? <ConfirmDialog title="Rotate webhook secret" description="Update the sender after rotating. Requests using the current secret will be refused."
      actionLabel="Rotate secret" busy={action.busy} onClose={() => setRotating(null)} onConfirm={() => void action.run(async () => {
        const updated = await api<InboundHook>(`${endpoint}/${rotating.id}/rotate`, 'POST');
        setRotating(null);
        setConnection(updated);
        hooks.refresh();
      })} /> : null}
  </Panel>;
}
