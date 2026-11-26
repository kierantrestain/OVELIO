'use client';

// Shared Email Studio pieces: sandboxed email frame, media picker, sample-contact preview, test send and sent tests.
import { ImageIcon, Link2, MailCheck, Monitor, Smartphone, Upload } from 'lucide-react';
import { useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { FileInput } from '@astryxdesign/core/FileInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { MediaItem } from '@/contracts';
import type { RenderedPreview, SampleContact, SentMessage, StoredMessage, TestSendResult } from '@/contracts/studio';
import { api, date, upload, useAction, useResource } from '../client';
import { AsyncState, Empty, Feedback, FormActions, Modal, SlideDrawer, StatusBadge } from '../ui';
import type { Tone } from '../ui';
import '@/styles/studio.css';

/** Renders email HTML in a sandboxed frame: no scripts, no same-origin access. */
export function EmailFrame({ html, title, device = 'desktop', height = 640 }: { html: string; title: string; device?: 'desktop' | 'mobile'; height?: number }) {
  return <div className={`ov-studio-frame ov-studio-frame--${device}`}>
    <iframe title={title} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={html} style={{ height }} />
  </div>;
}

export function DeviceToggle({ value, onChange }: { value: 'desktop' | 'mobile'; onChange: (value: 'desktop' | 'mobile') => void }) {
  return <SegmentedControl label="Preview width" size="sm" value={value} onChange={next => onChange(next === 'mobile' ? 'mobile' : 'desktop')}>
    <SegmentedControlItem value="desktop" label="Desktop" icon={<Monitor size={14} />} />
    <SegmentedControlItem value="mobile" label="Mobile" icon={<Smartphone size={14} />} />
  </SegmentedControl>;
}

const statusTone: Record<string, Tone> = { sent: 'success', not_sent: 'warning', blocked: 'error', failed: 'error', error: 'error' };
const statusLabel: Record<string, string> = { sent: 'Sent', not_sent: 'Not delivered', blocked: 'Blocked', failed: 'Failed', error: 'Error' };

export function SendStatus({ status }: { status: string }) {
  return <StatusBadge label={statusLabel[status] ?? status} tone={statusTone[status] ?? 'neutral'} />;
}

/** Neutral, generated placeholder images so a draft never needs a hotlinked picture. */
function placeholder(variant: number) {
  const colors = [['#2457d6', '#f59e0b'], ['#0f766e', '#a7f3d0'], ['#7c3aed', '#fde68a'], ['#111827', '#60a5fa']][variant % 4];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='600' viewBox='0 0 1200 600'><rect width='1200' height='600' fill='${colors[0]}'/><circle cx='960' cy='160' r='260' fill='${colors[1]}' opacity='.85'/><circle cx='180' cy='620' r='300' fill='#ffffff' opacity='.12'/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + svg.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23');
}

function absolute(url: string) {
  if (/^(https?:|data:)/i.test(url)) return url;
  return window.location.origin + (url.startsWith('/') ? url : '/' + url);
}

/** The shared media library (GET/POST /api/console/media) as an image picker, with upload and URL entry. */
export function MediaPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const media = useResource<MediaItem[]>('/media');
  const uploader = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const images = (media.data ?? []).filter(item => item.contentType.startsWith('image/'));
  return <Modal title="Choose an image" onClose={onClose} size="large">
    <div className="ov-studio-media-upload">
      <FileInput mode="dropzone" label="Upload to the media library" description="PNG, JPEG, GIF, WebP or SVG up to 8 MB."
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" maxSize={8 * 1024 * 1024} value={file}
        onChange={next => setFile(Array.isArray(next) ? next[0] ?? null : next)} isLoading={uploader.busy} />
      <FormActions>
        <Button variant="primary" icon={<Upload size={15} />} label="Upload and use" isDisabled={!file} isLoading={uploader.busy}
          onClick={() => void uploader.run(async () => {
            if (!file) return;
            const item = await upload<MediaItem>('/media', file);
            media.refresh();
            onPick(absolute(item.url));
          })} />
      </FormActions>
      <Feedback error={uploader.error} />
    </div>
    <Text type="label">Media library</Text>
    {!media.data ? <AsyncState loading={media.loading} error={media.error} retry={media.refresh} />
      : images.length ? <div className="ov-studio-media-grid">
        {images.map(item => <button type="button" key={item.id} className="ov-studio-media-tile" onClick={() => onPick(absolute(item.url))} title={item.filename}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumbUrl || item.url} alt="" loading="lazy" />
          <span>{item.filename}</span>
        </button>)}
      </div> : <Empty title="No images in the media library yet" description="Upload one above, or start from a placeholder below." />}
    <Text type="label">Placeholders</Text>
    <div className="ov-studio-media-grid">
      {[0, 1, 2, 3].map(variant => <button type="button" key={variant} className="ov-studio-media-tile" onClick={() => onPick(placeholder(variant))} aria-label={`Placeholder image ${variant + 1}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={placeholder(variant)} alt="" />
        <span>Placeholder {variant + 1}</span>
      </button>)}
    </div>
    <form className="ov-actions" onSubmit={event => { event.preventDefault(); if (/^https?:\/\//i.test(url.trim())) onPick(url.trim()); }}>
      <TextInput label="Or use an image address" placeholder="https://…" value={url} onChange={setUrl} startIcon={<Link2 size={14} />} width={420} />
      <Button type="submit" label="Use address" icon={<ImageIcon size={15} />} isDisabled={!/^https?:\/\//i.test(url.trim())} />
    </form>
  </Modal>;
}

export function ContactPicker({ value, onChange, label = 'Sample contact' }: { value: SampleContact | null; onChange: (contact: SampleContact | null) => void; label?: string }) {
  const contacts = useResource<{ items: SampleContact[] }>('/studio/sample-contacts');
  const items = contacts.data?.items ?? [];
  return <Selector label={label} hasSearch value={value ? String(value.id) : 'none'} isLoading={contacts.loading} width={300}
    onChange={next => onChange(items.find(item => String(item.id) === next) ?? null)}
    options={[{ value: 'none', label: 'No contact (fallbacks)' }, ...items.map(item => ({ value: String(item.id), label: item.name, description: item.email }))]} />;
}

/** Personalised preview: merge tags resolved against a chosen contact, desktop and mobile widths. */
export function PreviewDialog({ designId, onClose }: { designId: string; onClose: () => void }) {
  const [contact, setContact] = useState<SampleContact | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const preview = useResource<RenderedPreview>(`/studio/designs/${designId}/render${contact ? `?contactId=${contact.id}` : ''}`);
  return <Modal title="Preview" onClose={onClose} size="wide">
    <div className="ov-actions ov-actions--between">
      <ContactPicker value={contact} onChange={setContact} />
      <DeviceToggle value={device} onChange={setDevice} />
    </div>
    {preview.data ? <>
      <div className="ov-studio-inbox">
        <strong>{preview.data.subject || 'No subject yet'}</strong>
        <span>{preview.data.preheader}</span>
      </div>
      {preview.data.unknownTags.length ? <Banner status="warning" title={`Unknown personalisation: ${preview.data.unknownTags.map(tag => `{{${tag}}}`).join(', ')}`} description="These stay as written in the email. Check the spelling or pick a tag from the Personalise menu." /> : null}
      <EmailFrame html={preview.data.html} title="Personalised email preview" device={device} height={560} />
    </> : <AsyncState loading={preview.loading} error={preview.error} retry={preview.refresh} />}
  </Modal>;
}

/** Sends the saved design to up to five consenting contacts through the OVELIO mailer and shows each result as returned. */
export function TestSendDialog({ designId, prepare, onClose, onSent }: {
  designId: string; prepare?: () => Promise<void>; onClose: () => void; onSent?: () => void;
}) {
  const action = useAction();
  const [contact, setContact] = useState<SampleContact | null>(null);
  const [extra, setExtra] = useState('');
  const [results, setResults] = useState<TestSendResult[]>();
  const recipients = [contact?.email, ...extra.split(/[\s,;]+/)].filter((item): item is string => !!item && item.includes('@'));
  return <Modal title="Send a test email" onClose={onClose} size="large">
    <Text color="secondary">Tests go only to contacts with recorded email consent. The exact message each person receives is stored, so you can open it from Sent tests.</Text>
    <ContactPicker value={contact} onChange={setContact} label="Send to a contact" />
    <TextInput label="Other addresses" description="Separate up to five addresses with commas. Each must be a consenting contact." value={extra} onChange={setExtra} placeholder="name@example.com" isOptional />
    {results ? <ul className="ov-studio-results" aria-label="Test send results">
      {results.map(item => <li key={item.to}><span><strong>{item.to}</strong><Text type="supporting" color="secondary">{item.reason}</Text></span><SendStatus status={item.status} /></li>)}
    </ul> : null}
    <Feedback error={action.error} />
    <FormActions>
      <Button label="Close" onClick={onClose} />
      <Button variant="primary" icon={<MailCheck size={15} />} label="Send test" isLoading={action.busy} isDisabled={!recipients.length}
        onClick={() => void action.run(async () => {
          await prepare?.();
          const sent = await api<{ results: TestSendResult[] }>(`/studio/designs/${designId}/test`, 'POST', { to: [...new Set(recipients)].slice(0, 5) });
          setResults(sent.results);
          onSent?.();
        })} />
    </FormActions>
  </Modal>;
}

export function SentTestsDrawer({ designId, onClose }: { designId: string; onClose: () => void }) {
  const messages = useResource<{ items: SentMessage[] }>(`/studio/designs/${designId}/messages`);
  const [open, setOpen] = useState<string>();
  const stored = useResource<StoredMessage>(open ? `/studio/messages/${open}` : null);
  return <SlideDrawer title="Sent tests" subtitle="Every test and its result, with the exact message stored" onClose={onClose} width={720}>
    {!messages.data ? <AsyncState loading={messages.loading} error={messages.error} retry={messages.refresh} />
      : messages.data.items.length ? <ul className="ov-studio-results">
        {messages.data.items.map(item => <li key={item.id}>
          <span><strong>{item.to}</strong><Text type="supporting" color="secondary">{date(item.createdAt)} · {item.reason}</Text></span>
          <span className="ov-actions"><SendStatus status={item.status} /><Button size="sm" label={open === item.id ? 'Showing' : 'Open message'} onClick={() => setOpen(item.id)} /></span>
        </li>)}
      </ul> : <Empty title="No tests sent yet" description="Use Send test to check the email in a real inbox." />}
    {open ? (stored.data ? <div className="ov-stack-sm">
      <div className="ov-studio-inbox"><strong>{stored.data.subject}</strong><span>From {stored.data.fromName} &lt;{stored.data.fromEmail}&gt; · To {stored.data.to}</span></div>
      <EmailFrame html={stored.data.html} title="Stored rendered message" height={520} />
    </div> : <AsyncState loading={stored.loading} error={stored.error} retry={stored.refresh} />) : null}
  </SlideDrawer>;
}
