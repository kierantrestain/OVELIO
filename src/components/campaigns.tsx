'use client';

import {
  Ban, Check, Copy, Download, Eye, FileText, MailCheck, Pause, Pencil, Plus, RefreshCw, Search, Send, Sparkles, Star,
  Timer, Trash2, Upload, X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateTimeInput } from '@astryxdesign/core/DateTimeInput';
import type { ISODateTimeString } from '@astryxdesign/core/DateTimeInput';
import { FileInput } from '@astryxdesign/core/FileInput';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import type {
  Campaign, CampaignInput, CampaignLinkStat, MailingList, MediaItem, Page, Point, RunningCampaignStat, Template,
  TemplateInput, TransactionalEmailInput,
} from '@/contracts';
import { api, date, number, saveFile, upload, useAction, useFields, useResource } from './client';
import { EmailMetrics } from './overview';
import { useUser } from './shell';
import {
  AsyncState, Bars, ConfirmDialog, Distribution, Empty, Feedback, FormActions, Modal, PageHeader, Pager, Panel,
  SendProgress, StatusBadge, Tabs,
} from './ui';
import type { Tone } from './ui';

const path = '/campaigns';
const tabs = ['Newsletters', 'Templates', 'Media', 'Transactional'] as const;
export type CampaignTab = typeof tabs[number];

type CampaignAnalytics = {
  views: Point[] | null;
  clicks: Point[] | null;
  bounces: Point[] | null;
  links: CampaignLinkStat[];
};

const statusFilterOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'running', label: 'Sending' },
  { value: 'paused', label: 'Paused' },
  { value: 'finished', label: 'Finished' },
  { value: 'cancelled', label: 'Cancelled' },
];

const contentFormatOptions = [
  { value: 'html', label: 'HTML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'plain', label: 'Plain text' },
];

const templateTypeOptions = [
  { value: 'campaign', label: 'Newsletter', description: 'Reusable layout wrapping newsletter body content' },
  { value: 'tx', label: 'Transactional', description: 'Single-recipient template triggered with custom data' },
];

const exportMetrics = [
  { value: 'views', label: 'Opens CSV' },
  { value: 'clicks', label: 'Clicks CSV' },
  { value: 'links', label: 'Links CSV' },
  { value: 'bounces', label: 'Bounces CSV' },
] as const;

const layoutStarter = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="22" style="max-width:600px;font-family:Arial,sans-serif;color:#111827">
      <tr><td>
        <h1 style="margin:0 0 12px;font-size:24px">Your newsletter heading</h1>
        <p style="margin:0 0 16px;line-height:1.6">Hi {{ .Subscriber.FirstName }}, write your first update here.</p>
        <p style="margin:0;font-size:13px;color:#6b7280"><a href="{{ UnsubscribeURL }}">Unsubscribe</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

const templateStarter = `<div style="max-width:600px;margin:0 auto;padding:24px;font-family:Arial,sans-serif;color:#111827">
  {{ template "content" . }}
</div>`;

const txTemplateStarter = `<div style="max-width:600px;margin:0 auto;padding:24px;font-family:Arial,sans-serif;color:#111827">
  <h2 style="margin:0 0 12px">Hello {{ .Subscriber.FirstName }},</h2>
  <p style="margin:0 0 16px;line-height:1.6">{{ .Tx.Data.message }}</p>
</div>`;

const emptyPreviewHtml = '<div style="font-family:sans-serif;color:#64748b;padding:24px;font-size:14px">Start writing HTML to see a live preview here.</div>';
const templatePreviewSlot = '<div style="margin:12px 0;padding:18px;border:1px dashed #94a3b8;border-radius:6px;background:#f8fafc;color:#475569;font-family:sans-serif;font-size:14px">Newsletter body content renders here.</div>';
const acceptedMediaTypes = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf';
const maxMediaBytes = 8 * 1024 * 1024;

const statusTone: Record<string, Tone> = {
  finished: 'success',
  running: 'success',
  scheduled: 'info',
  paused: 'warning',
  cancelled: 'error',
};

function resolveCampaignTab(value?: string): CampaignTab {
  const normalized = value?.trim().toLowerCase();
  return tabs.find(item => item.toLowerCase() === normalized) ?? 'Newsletters';
}

function Status({ status }: { status: string }) {
  const label = status === 'running' ? 'Sending' : status ? status[0].toUpperCase() + status.slice(1) : 'Unknown';
  return <StatusBadge label={label} tone={statusTone[status] ?? 'neutral'} />;
}

function formatLabel(value?: string) {
  if (value === 'markdown') return 'Markdown';
  if (value === 'plain') return 'Plain text';
  if (value === 'richtext') return 'Rich text';
  return 'HTML';
}

function canDeleteCampaign(status: string) {
  return ['draft', 'cancelled', 'finished'].includes(status);
}

function resolveMediaUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === 'undefined') return url;
  return window.location.origin + (url.startsWith('/') ? url : '/' + url);
}

function escapeHtmlAttr(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function useRunningCampaigns(enabled: boolean) {
  const [items, setItems] = useState<RunningCampaignStat[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const poll = () => {
      void api<RunningCampaignStat[]>('/campaigns/running').then(
        data => { if (active) setItems(data); },
        () => { /* Keep banner resilient if a poll transiently fails */ },
      );
    };
    poll();
    const timer = window.setInterval(poll, 6000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [enabled, tick]);

  return {
    items: enabled ? items : [],
    refresh: () => setTick(value => value + 1),
  };
}

function CampaignForm({ campaign, onClose, onDone }: {
  campaign?: Campaign; onClose: () => void; onDone: (value: Campaign) => void;
}) {
  const lists = useResource<MailingList[]>('/lists');
  const templates = useResource<Template[]>('/templates?type=campaign');
  const media = useResource<MediaItem[]>('/media');
  const action = useAction();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { values, field, setValues } = useFields({
    name: campaign?.name ?? '',
    subject: campaign?.subject ?? '',
    tags: campaign?.tags?.join(', ') ?? '',
    body: campaign?.body ?? '',
    altBody: campaign?.altBody ?? '',
  });
  const [listIds, setListIds] = useState<number[]>(campaign?.listIds ?? []);
  const [templateId, setTemplateId] = useState(campaign?.templateId ? String(campaign.templateId) : 'default');
  const [contentType, setContentType] = useState<'html' | 'markdown' | 'plain'>(
    campaign?.contentType === 'markdown' || campaign?.contentType === 'plain' ? campaign.contentType : 'html',
  );
  const [archive, setArchive] = useState(Boolean(campaign?.archive));
  const [previewDevice, setPreviewDevice] = useState('desktop');
  const hasLists = !!lists.data?.length;

  function insertSnippet(snippet: string) {
    const element = bodyRef.current;
    if (element && typeof element.selectionStart === 'number') {
      const start = element.selectionStart;
      const end = element.selectionEnd ?? start;
      const next = values.body.slice(0, start) + snippet + values.body.slice(end);
      setValues(current => ({ ...current, body: next }));
      window.requestAnimationFrame(() => {
        element.focus();
        const caret = start + snippet.length;
        element.setSelectionRange(caret, caret);
      });
      return;
    }
    setValues(current => ({ ...current, body: current.body ? `${current.body}\n${snippet}` : snippet }));
  }

  function insertMedia(mediaId: string | null) {
    if (!mediaId) return;
    const item = media.data?.find(entry => String(entry.id) === mediaId);
    if (!item) return;
    const url = resolveMediaUrl(item.url);
    const label = escapeHtmlAttr(item.filename);
    const snippet = item.contentType.startsWith('image/')
      ? `<img src="${url}" alt="${label}" style="max-width:100%;height:auto;border:0;" />`
      : `<a href="${url}">${label}</a>`;
    insertSnippet(snippet);
  }

  const quickVariables = (
    <div className="ov-actions">
      <Button size="sm" label="First Name" onClick={() => insertSnippet('{{ .Subscriber.FirstName }}')} />
      <Button size="sm" label="Email" onClick={() => insertSnippet('{{ .Subscriber.Email }}')} />
      <Button size="sm" label="Unsubscribe" onClick={() => insertSnippet('{{ UnsubscribeURL }}')} />
      {contentType === 'html' ? (
        <Button size="sm" icon={<Sparkles size={13} />} label="Starter layout"
          onClick={() => setValues(current => ({ ...current, body: current.body.trim() ? `${current.body}\n${layoutStarter}` : layoutStarter }))} />
      ) : null}
    </div>
  );

  return <Modal title={campaign ? 'Edit newsletter' : 'Create newsletter'} onClose={onClose} size="wide">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        if (!listIds.length) throw new Error('Choose at least one mailing list.');
        const tags = values.tags.split(',').map(tag => tag.trim()).filter(Boolean);
        const input: CampaignInput = {
          name: values.name.trim(),
          subject: values.subject.trim(),
          body: values.body,
          altBody: values.altBody.trim() || undefined,
          contentType,
          tags,
          listIds,
          templateId: templateId === 'default' ? undefined : Number(templateId),
          archive,
        };
        onDone(await api<Campaign>(campaign ? `${path}/${campaign.id}` : path, campaign ? 'PATCH' : 'POST', input));
      });
    }}>
      <div className="ov-form-grid">
        <TextInput label="Newsletter name" isRequired {...field('name')} />
        <TextInput label="Subject" isRequired {...field('subject')} />
      </div>

      {hasLists ? <fieldset className="ov-stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
        <Text as="label" type="label">Mailing lists</Text>
        <div className="ov-form-grid">
          {lists.data?.map(list => <CheckboxInput
            key={list.id}
            label={list.name}
            description={list.subscriberCount == null ? undefined : `${number(list.subscriberCount)} subscribers`}
            value={listIds.includes(list.id)}
            onChange={checked => setListIds(ids => checked ? [...ids, list.id] : ids.filter(item => item !== list.id))}
          />)}
        </div>
      </fieldset> : lists.data ? <Text color="secondary">Create or sync a mailing list in <Link href="/audience?tab=Mailing+lists">Audience</Link> before composing a newsletter.</Text>
        : <AsyncState loading={lists.loading} error={lists.error} retry={lists.refresh} />}

      <div className="ov-form-grid--three ov-form-grid">
        <Selector label="Email template" value={templateId} onChange={value => setTemplateId(value ?? 'default')} isLoading={templates.loading}
          options={[{ value: 'default', label: 'Default template' }, ...(templates.data ?? []).map(item => ({ value: String(item.id), label: item.name }))]} />
        <Selector label="Content format" value={contentType}
          onChange={value => setContentType((value as 'html' | 'markdown' | 'plain') || 'html')}
          options={contentFormatOptions} />
        <TextInput label="Tags" placeholder="product, monthly" description="Separate tags with commas." isOptional {...field('tags')} />
      </div>

      <Switch label="Include in public archive" description="Store a web-accessible copy after delivery." value={archive} onChange={setArchive} />
      <Feedback error={templates.error} />

      {contentType === 'html' ? <div className="ov-split">
        <div className="ov-stack-sm">
          {quickVariables}
          {media.data?.length ? <Selector
            label="Insert media"
            placeholder="Insert uploaded image or file URL…"
            value={null}
            hasClear
            onChange={insertMedia}
            options={media.data.map(item => ({ value: String(item.id), label: item.filename, description: item.contentType }))}
          /> : null}
          <TextArea ref={bodyRef} label="Email content (HTML)" rows={14} isRequired placeholder="<h1>News from your team</h1>" hasSpellCheck={false} {...field('body')} />
        </div>
        <div className="ov-stack-sm">
          <div className="ov-actions ov-actions--between">
            <Text type="label">Live preview</Text>
            <SegmentedControl label="Preview width" size="sm" value={previewDevice} onChange={setPreviewDevice}>
              <SegmentedControlItem value="desktop" label="Desktop" />
              <SegmentedControlItem value="mobile" label="Mobile" />
            </SegmentedControl>
          </div>
          <iframe
            title="Live newsletter preview"
            className={`ov-preview ${previewDevice === 'mobile' ? 'ov-preview--mobile' : ''}`}
            style={{ height: 400 }}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={values.body.trim() ? values.body : emptyPreviewHtml}
          />
        </div>
      </div> : <div className="ov-stack-sm">
        {quickVariables}
        <TextArea
          ref={bodyRef}
          label={contentType === 'markdown' ? 'Email content (Markdown)' : 'Email content (Plain text)'}
          rows={12}
          isRequired
          hasSpellCheck={contentType === 'plain'}
          placeholder={contentType === 'markdown' ? '# News from your team' : 'Write your plain-text newsletter update…'}
          {...field('body')}
        />
      </div>}

      {contentType !== 'plain' ? (
        <TextArea
          label="Plain-text fallback"
          description="Optional plain-text version for email clients that do not render HTML."
          rows={4}
          isOptional
          placeholder="Plain-text summary of your newsletter…"
          {...field('altBody')}
        />
      ) : null}

      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={campaign ? 'Save changes' : 'Save draft'} isLoading={action.busy} isDisabled={!hasLists || !values.body.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function TemplateForm({ template, defaultType = 'campaign', onClose, onDone }: {
  template?: Template; defaultType?: 'campaign' | 'tx'; onClose: () => void; onDone: (notice: string) => void;
}) {
  const action = useAction();
  const initialType: 'campaign' | 'tx' = template?.type === 'tx' ? 'tx' : template ? 'campaign' : defaultType;
  const [type, setType] = useState<'campaign' | 'tx'>(initialType);
  const [previewDevice, setPreviewDevice] = useState('desktop');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { values, field, setValues } = useFields({
    name: template?.name ?? '',
    subject: template?.subject ?? '',
    body: template?.body ?? (initialType === 'tx' ? txTemplateStarter : templateStarter),
  });

  function insertToken(token: string) {
    const element = bodyRef.current;
    if (element && typeof element.selectionStart === 'number') {
      const start = element.selectionStart;
      const end = element.selectionEnd ?? start;
      const next = values.body.slice(0, start) + token + values.body.slice(end);
      setValues(current => ({ ...current, body: next }));
      window.requestAnimationFrame(() => {
        element.focus();
        const caret = start + token.length;
        element.setSelectionRange(caret, caret);
      });
      return;
    }
    setValues(current => ({ ...current, body: current.body ? `${current.body}\n${token}` : token }));
  }

  const previewHtml = values.body.trim()
    ? (type === 'campaign'
      ? values.body.replaceAll(/\{\{\s*template\s+"content"\s+\.\s*\}\}/g, templatePreviewSlot)
      : values.body)
    : emptyPreviewHtml;

  return <Modal title={template ? 'Edit email template' : 'Create email template'} onClose={onClose} size="wide">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const payload: TemplateInput = {
          name: values.name.trim(),
          type,
          body: values.body,
          ...(values.subject.trim() ? { subject: values.subject.trim() } : {}),
        };
        await api(template ? `/templates/${template.id}` : '/templates', template ? 'PATCH' : 'POST', payload);
        onDone(template ? 'Template updated.' : 'Template saved.');
      });
    }}>
      <div className="ov-form-grid">
        <TextInput label="Template name" isRequired {...field('name')} />
        <Selector
          label="Template type"
          value={type}
          isDisabled={!!template}
          disabledMessage="Template type cannot be changed after creation."
          onChange={next => {
            const kind = next === 'tx' ? 'tx' : 'campaign';
            setType(kind);
            if (!template && (values.body === templateStarter || values.body === txTemplateStarter)) {
              setValues(current => ({ ...current, body: kind === 'tx' ? txTemplateStarter : templateStarter }));
            }
          }}
          options={templateTypeOptions}
        />
      </div>

      {type === 'tx' ? (
        <TextInput
          label="Default subject"
          description="Optional default subject line used when sending transactional emails with this template."
          isOptional
          placeholder="Your receipt from our team"
          {...field('subject')}
        />
      ) : null}

      <div className="ov-split">
        <div className="ov-stack-sm">
          <div className="ov-actions">
            {type === 'campaign' ? <>
              <Button size="sm" label="Content slot" onClick={() => insertToken('{{ template "content" . }}')} />
              <Button size="sm" label="Unsubscribe" onClick={() => insertToken('{{ UnsubscribeURL }}')} />
            </> : <>
              <Button size="sm" label="First Name" onClick={() => insertToken('{{ .Subscriber.FirstName }}')} />
              <Button size="sm" label="Email" onClick={() => insertToken('{{ .Subscriber.Email }}')} />
              <Button size="sm" label="Variable" onClick={() => insertToken('{{ .Tx.Data.message }}')} />
            </>}
          </div>
          <TextArea
            ref={bodyRef}
            label="Template HTML"
            description={type === 'campaign'
              ? 'Include {{ template "content" . }} where the newsletter body should appear.'
              : 'Use {{ .Tx.Data.key }} placeholders for dynamic transactional variables.'}
            rows={14}
            hasSpellCheck={false}
            isRequired
            {...field('body')}
          />
        </div>
        <div className="ov-stack-sm">
          <div className="ov-actions ov-actions--between">
            <Text type="label">Live preview</Text>
            <SegmentedControl label="Preview width" size="sm" value={previewDevice} onChange={setPreviewDevice}>
              <SegmentedControlItem value="desktop" label="Desktop" />
              <SegmentedControlItem value="mobile" label="Mobile" />
            </SegmentedControl>
          </div>
          <iframe
            title="Live template preview"
            className={`ov-preview ${previewDevice === 'mobile' ? 'ov-preview--mobile' : ''}`}
            style={{ height: 390 }}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={previewHtml}
          />
        </div>
      </div>

      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={template ? 'Save changes' : 'Save template'} isLoading={action.busy} isDisabled={!values.name.trim() || !values.body.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function TemplatePreviewModal({ template, onClose }: { template: Template; onClose: () => void }) {
  const preview = useResource<string>(`/templates/${template.id}/preview`);
  const [device, setDevice] = useState('desktop');
  return <Modal title={`Preview: ${template.name}`} onClose={onClose} size="large">
    <SegmentedControl label="Preview width" value={device} onChange={setDevice}>
      <SegmentedControlItem value="desktop" label="Desktop" />
      <SegmentedControlItem value="mobile" label="Mobile" />
    </SegmentedControl>
    {preview.data ? (
      <iframe
        title={`Template preview for ${template.name}`}
        className={`ov-preview ${device === 'mobile' ? 'ov-preview--mobile' : ''}`}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={preview.data}
      />
    ) : <AsyncState loading={preview.loading} error={preview.error} retry={preview.refresh} />}
  </Modal>;
}

function MediaTab({ canEdit }: { canEdit: boolean }) {
  const media = useResource<MediaItem[]>('/media');
  const uploader = useAction();
  const remover = useAction();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaItem>();
  const [copiedId, setCopiedId] = useState<number>();
  const [copyError, setCopyError] = useState<string>();

  async function copyUrl(item: MediaItem) {
    setCopyError(undefined);
    const fullUrl = resolveMediaUrl(item.url);
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(current => current === item.id ? undefined : current), 2000);
    } catch {
      setCopyError(`Unable to access clipboard. Copy manually: ${fullUrl}`);
    }
  }

  return <div className="ov-stack">
    {canEdit ? <Panel title="Upload media" description="Host images and PDF attachments for newsletters and templates.">
      <form className="ov-stack-sm" onSubmit={event => {
        event.preventDefault();
        void uploader.run(async () => {
          if (!selectedFile) throw new Error('Choose an image or PDF file to upload.');
          await upload<MediaItem>('/media', selectedFile);
          setSelectedFile(null);
          media.refresh();
        }, 'Media file uploaded.');
      }}>
        <FileInput
          mode="dropzone"
          label="Upload image or PDF"
          description="Accepted formats: PNG, JPEG, GIF, WebP, SVG and PDF (up to 8 MB)."
          accept={acceptedMediaTypes}
          maxSize={maxMediaBytes}
          value={selectedFile}
          onChange={next => setSelectedFile(Array.isArray(next) ? next[0] ?? null : next)}
          isLoading={uploader.busy}
        />
        <Feedback error={uploader.error} notice={uploader.notice} />
        <FormActions>
          <Button type="submit" variant="primary" icon={<Upload size={15} />} label="Upload file" isLoading={uploader.busy} isDisabled={!selectedFile} />
        </FormActions>
      </form>
    </Panel> : null}

    <Panel
      title="Media library"
      description={media.data ? `${number(media.data.length)} uploaded file${media.data.length === 1 ? '' : 's'}` : 'Uploaded newsletter images and files.'}
      action={<Button size="sm" label="Refresh" icon={<RefreshCw size={14} />} onClick={media.refresh} isLoading={media.loading && !!media.data} />}
    >
      <Feedback error={remover.error || copyError} notice={remover.notice} />
      {!media.data ? <AsyncState loading={media.loading} error={media.error} retry={media.refresh} />
        : media.data.length ? <div className="ov-media-grid">
          {media.data.map(item => {
            const isImage = item.contentType.startsWith('image/');
            return <Card key={item.id}>
              <div className="ov-stack-sm">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="ov-media-thumb" src={item.thumbUrl || item.url} alt={item.filename} loading="lazy" />
                ) : (
                  <div className="ov-media-thumb" style={{ display: 'grid', placeItems: 'center', alignContent: 'center', gap: 6 }}>
                    <FileText size={28} aria-hidden="true" />
                    <StatusBadge label={item.contentType === 'application/pdf' ? 'PDF' : 'FILE'} tone="info" />
                  </div>
                )}
                <div className="ov-cell" title={item.filename}>
                  <Text weight="medium" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.filename}
                  </Text>
                  <Text type="supporting" color="secondary">
                    {item.contentType}{item.createdAt ? ` · ${date(item.createdAt)}` : ''}
                  </Text>
                </div>
                <div className="ov-actions ov-actions--between">
                  <Button
                    size="sm"
                    icon={copiedId === item.id ? <Check size={14} /> : <Copy size={14} />}
                    label={copiedId === item.id ? 'Copied' : 'Copy URL'}
                    onClick={() => void copyUrl(item)}
                  />
                  {canEdit ? (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Delete ${item.filename}`}
                      icon={<Trash2 size={15} />}
                      onClick={() => setPendingDelete(item)}
                    />
                  ) : null}
                </div>
              </div>
            </Card>;
          })}
        </div> : <Empty title="No media files uploaded" description="Upload images or PDFs above to embed them into newsletters and templates." />}
    </Panel>

    {pendingDelete ? <ConfirmDialog
      title="Delete media file"
      description={`Permanently delete "${pendingDelete.filename}"? Newsletters already referencing this URL may no longer display it.`}
      actionLabel="Delete file"
      busy={remover.busy}
      onClose={() => setPendingDelete(undefined)}
      onConfirm={() => void remover.run(async () => {
        await api(`/media/${pendingDelete.id}`, 'DELETE');
        setPendingDelete(undefined);
        media.refresh();
      }, 'Media file deleted.')}
    /> : null}
  </div>;
}

function TransactionalTab({ canEdit, onCreateTxTemplate }: { canEdit: boolean; onCreateTxTemplate: () => void }) {
  const templates = useResource<Template[]>('/templates?type=tx');
  const action = useAction();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const { values, field, setValues } = useFields({ email: '', subject: '', data: '{\n  "message": "Your request is confirmed."\n}' });

  const resolvedTemplateId = templateId ?? (templates.data?.[0] ? String(templates.data[0].id) : null);
  const selectedTemplate = templates.data?.find(item => String(item.id) === resolvedTemplateId);

  return <div className="ov-grid">
    <Panel
      title="Send transactional email"
      description="Deliver a template-based message to a single recipient with custom variables."
    >
      <Text type="supporting" color="secondary">
        Workspace consent and suppression policies still apply. Messages are only sent to audience contacts with active email consent, and suppressed addresses are automatically blocked.
      </Text>

      {!templates.data ? <AsyncState loading={templates.loading} error={templates.error} retry={templates.refresh} />
        : !templates.data.length ? <Empty
          title="No transactional templates"
          description="Create a transactional template first to send single-recipient emails."
          action={canEdit ? <Button variant="primary" icon={<Plus size={15} />} label="Create transactional template" onClick={onCreateTxTemplate} /> : undefined}
        /> : <form className="ov-stack-sm" onSubmit={event => {
          event.preventDefault();
          void action.run(async () => {
            if (!resolvedTemplateId) throw new Error('Choose a transactional template.');
            let parsedData: Record<string, unknown> | undefined;
            if (values.data.trim()) {
              let raw: unknown;
              try {
                raw = JSON.parse(values.data);
              } catch {
                throw new Error('Template variables must be valid JSON.');
              }
              if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                throw new Error('Template variables must be a JSON object.');
              }
              parsedData = raw as Record<string, unknown>;
            }
            const payload: TransactionalEmailInput = {
              email: values.email.trim(),
              templateId: Number(resolvedTemplateId),
              ...(values.subject.trim() ? { subject: values.subject.trim() } : {}),
              ...(parsedData ? { data: parsedData } : {}),
            };
            await api('/tx', 'POST', payload);
            setValues(current => ({ ...current, email: '', subject: '' }));
          }, 'Transactional email queued for delivery.');
        }}>
          <Selector
            label="Transactional template"
            isRequired
            value={resolvedTemplateId ?? String(templates.data[0].id)}
            onChange={next => setTemplateId(next)}
            options={templates.data.map(item => ({
              value: String(item.id),
              label: item.name,
              description: item.subject || undefined,
            }))}
          />
          <TextInput
            label="Recipient email"
            type="email"
            isRequired
            description="Must match an opted-in contact in your audience."
            placeholder="alex@example.com"
            {...field('email')}
          />
          <TextInput
            label="Subject override"
            isOptional
            placeholder={selectedTemplate?.subject || 'Uses the template default subject when left blank'}
            {...field('subject')}
          />
          <TextArea
            label="Template variables (JSON)"
            description="Optional JSON object exposed inside the template as {{ .Tx.Data.<key> }}."
            rows={6}
            hasSpellCheck={false}
            isOptional
            {...field('data')}
          />
          <Feedback error={action.error} notice={action.notice} />
          <FormActions>
            <Button
              type="submit"
              variant="primary"
              icon={<Send size={15} />}
              label="Send transactional email"
              isLoading={action.busy}
              isDisabled={!canEdit || !resolvedTemplateId || !values.email.trim()}
            />
          </FormActions>
        </form>}
    </Panel>

    <Panel
      title="Template preview"
      description={selectedTemplate ? (selectedTemplate.subject ? `Default subject: ${selectedTemplate.subject}` : selectedTemplate.name) : 'Inspect the selected template layout.'}
    >
      {selectedTemplate ? (
        <iframe
          title={`Transactional preview for ${selectedTemplate.name}`}
          className="ov-preview ov-preview--compact"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={selectedTemplate.body || emptyPreviewHtml}
        />
      ) : <Empty title="No template selected" description="Select a transactional template to preview its HTML markup." />}
    </Panel>
  </div>;
}

export function Campaigns({ initialTab }: { initialTab?: string } = {}) {
  const router = useRouter();
  const user = useUser();
  const canEdit = user.role !== 'analyst';
  const [tab, setTab] = useState<CampaignTab>(() => resolveCampaignTab(initialTab));
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [createCampaign, setCreateCampaign] = useState(false);
  const [templateModal, setTemplateModal] = useState<{ template?: Template; defaultType?: 'campaign' | 'tx' }>();
  const [previewTemplate, setPreviewTemplate] = useState<Template>();
  const [deleteCampaignTarget, setDeleteCampaignTarget] = useState<Campaign>();
  const [deleteTemplateTarget, setDeleteTemplateTarget] = useState<Template>();
  const [notice, setNotice] = useState('');

  const rowAction = useAction();

  const queryParams = new URLSearchParams({ page: String(page) });
  if (statusFilter !== 'all') queryParams.set('status', statusFilter);
  if (searchQuery) queryParams.set('q', searchQuery);
  const campaigns = useResource<Page<Campaign>>(tab === 'Newsletters' ? `${path}?${queryParams.toString()}` : null);
  const templates = useResource<Template[]>(tab === 'Templates' ? '/templates?type=all' : null);
  const running = useRunningCampaigns(tab === 'Newsletters');

  function openNewTemplate(defaultType: 'campaign' | 'tx' = 'campaign') {
    setNotice('');
    setTemplateModal({ defaultType });
  }

  return <>
    <PageHeader
      title="Campaigns"
      description="Compose newsletters, manage templates and media, and send transactional emails."
      actions={canEdit ? (
        tab === 'Newsletters'
          ? <Button variant="primary" icon={<Plus size={16} />} label="Create newsletter" onClick={() => { setCreateCampaign(true); setNotice(''); }} />
          : tab === 'Templates'
            ? <Button variant="primary" icon={<Plus size={16} />} label="Create template" onClick={() => openNewTemplate('campaign')} />
            : tab === 'Transactional'
              ? <Button variant="primary" icon={<Plus size={16} />} label="New transactional template" onClick={() => openNewTemplate('tx')} />
              : undefined
      ) : undefined}
    />

    <Tabs label="Campaign view" items={tabs} value={tab} onChange={value => { setTab(value); setNotice(''); }} />
    <Feedback error={rowAction.error} notice={notice || rowAction.notice} />

    {tab === 'Newsletters' ? <div className="ov-stack">
      {running.items.length ? <Panel
        title="Sending in progress"
        description="Live newsletter delivery progress updates automatically."
        action={<Button size="sm" label="Refresh" icon={<RefreshCw size={14} />} onClick={() => { running.refresh(); campaigns.refresh(); }} />}
      >
        <div className="ov-stack-sm">
          {running.items.map(stat => {
            const match = campaigns.data?.items.find(item => item.id === stat.id);
            return <SendProgress
              key={stat.id}
              label={match ? match.name : `Newsletter #${stat.id}`}
              sent={stat.sent}
              total={stat.toSend}
              rate={stat.rate || stat.netRate}
            />;
          })}
        </div>
      </Panel> : null}

      <Panel
        title="Newsletters"
        action={<Button size="sm" label="Refresh" icon={<RefreshCw size={14} />} onClick={() => { campaigns.refresh(); running.refresh(); }} isLoading={campaigns.loading && !!campaigns.data} />}
      >
        <div className="ov-toolbar">
          <form onSubmit={event => {
            event.preventDefault();
            setPage(1);
            setSearchQuery(searchDraft.trim());
          }}>
            <TextInput
              label="Search newsletters"
              isLabelHidden
              type="search"
              placeholder="Search newsletters…"
              value={searchDraft}
              onChange={setSearchDraft}
            />
            <Button type="submit" icon={<Search size={15} />} label="Search" />
            {searchQuery || searchDraft ? (
              <Button variant="ghost" icon={<X size={14} />} label="Clear" onClick={() => {
                setSearchDraft('');
                setSearchQuery('');
                setPage(1);
              }} />
            ) : null}
          </form>
          <Selector
            label="Filter by status"
            isLabelHidden
            value={statusFilter}
            onChange={value => { setStatusFilter(value ?? 'all'); setPage(1); }}
            options={statusFilterOptions}
          />
        </div>

        {!campaigns.data ? <AsyncState loading={campaigns.loading} error={campaigns.error} retry={campaigns.refresh} /> : <>
          <Table
            data={campaigns.data.items}
            idKey="id"
            hasHover
            emptyState={<Empty
              title={searchQuery || statusFilter !== 'all' ? 'No matching newsletters' : 'No newsletters yet'}
              description={searchQuery || statusFilter !== 'all'
                ? 'Try clearing your search or switching the status filter.'
                : 'Create a newsletter draft, preview it and send a test before delivery.'}
            />}
            columns={[
              {
                key: 'name',
                header: 'Newsletter',
                renderCell: item => <span className="ov-cell">
                  <Link href={`/campaigns/${item.id}`}>{item.name}</Link>
                  <Text type="supporting" color="secondary">{item.subject}</Text>
                </span>,
              },
              { key: 'status', header: 'Status', renderCell: item => <Status status={item.status} /> },
              {
                key: 'tags',
                header: 'Tags',
                renderCell: item => item.tags?.length
                  ? <span className="ov-tags">{item.tags.map(tag => <Token key={tag} label={tag} size="sm" />)}</span>
                  : <Text color="secondary">—</Text>,
              },
              { key: 'sendAt', header: 'Send time', renderCell: item => date(item.sendAt) },
              { key: 'sent', header: 'Sent', align: 'end', renderCell: item => number(item.metrics.sent) },
              { key: 'opens', header: 'Opens', align: 'end', renderCell: item => number(item.metrics.opens) },
              { key: 'clicks', header: 'Clicks', align: 'end', renderCell: item => number(item.metrics.clicks) },
              ...(canEdit ? [{
                key: 'id' as const,
                header: 'Actions',
                align: 'end' as const,
                renderCell: (item: Campaign) => <div className="ov-actions ov-actions--end">
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Clone ${item.name}`}
                    tooltip="Clone newsletter"
                    icon={<Copy size={15} />}
                    isDisabled={rowAction.busy}
                    onClick={() => void rowAction.run(async () => {
                      await api<Campaign>(`${path}/${item.id}/clone`, 'POST');
                      campaigns.refresh();
                    }, 'Newsletter cloned as a new draft.')}
                  />
                  {canDeleteCampaign(item.status) ? (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Delete ${item.name}`}
                      tooltip="Delete newsletter"
                      icon={<Trash2 size={15} />}
                      isDisabled={rowAction.busy}
                      onClick={() => setDeleteCampaignTarget(item)}
                    />
                  ) : null}
                </div>,
              }] : []),
            ]}
          />
          <Pager {...campaigns.data} onPage={setPage} />
        </>}
      </Panel>
    </div> : tab === 'Templates' ? <Panel
      title="Email templates"
      description="Manage reusable newsletter layouts and transactional email templates."
      action={<Button size="sm" label="Refresh" icon={<RefreshCw size={14} />} onClick={templates.refresh} isLoading={templates.loading && !!templates.data} />}
    >
      {!templates.data ? <AsyncState loading={templates.loading} error={templates.error} retry={templates.refresh} />
        : <Table
          data={templates.data}
          idKey="id"
          hasHover
          emptyState={<Empty title="No templates yet" description="Save a reusable newsletter layout or transactional template." />}
          columns={[
            {
              key: 'name',
              header: 'Template',
              renderCell: item => <span className="ov-cell">
                <Text weight="medium">{item.name}</Text>
                {item.subject ? <Text type="supporting" color="secondary">{item.subject}</Text> : null}
              </span>,
            },
            {
              key: 'type',
              header: 'Type',
              renderCell: item => <StatusBadge label={item.type === 'tx' ? 'Transactional' : 'Newsletter'} tone={item.type === 'tx' ? 'info' : 'neutral'} />,
            },
            {
              key: 'isDefault',
              header: 'Default',
              renderCell: item => item.isDefault
                ? <StatusBadge label="Default" tone="success" />
                : <Text color="secondary">—</Text>,
            },
            {
              key: 'id',
              header: 'Actions',
              align: 'end',
              renderCell: item => <div className="ov-actions ov-actions--end">
                <Button size="sm" icon={<Eye size={14} />} label="Preview" onClick={() => setPreviewTemplate(item)} />
                {canEdit && item.type !== 'tx' && !item.isDefault ? (
                  <Button
                    size="sm"
                    icon={<Star size={14} />}
                    label="Set as default"
                    isDisabled={rowAction.busy}
                    onClick={() => void rowAction.run(async () => {
                      await api(`/templates/${item.id}/default`, 'POST');
                      templates.refresh();
                    }, `"${item.name}" is now the default template.`)}
                  />
                ) : null}
                {canEdit ? <>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Edit ${item.name}`}
                    tooltip="Edit template"
                    icon={<Pencil size={15} />}
                    onClick={() => setTemplateModal({ template: item })}
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Delete ${item.name}`}
                    tooltip={item.isDefault ? 'Choose another default template before deleting this one.' : 'Delete template'}
                    icon={<Trash2 size={15} />}
                    isDisabled={rowAction.busy || Boolean(item.isDefault)}
                    onClick={() => setDeleteTemplateTarget(item)}
                  />
                </> : null}
              </div>,
            },
          ]}
        />}
    </Panel> : tab === 'Media' ? <MediaTab canEdit={canEdit} />
      : <TransactionalTab canEdit={canEdit} onCreateTxTemplate={() => { setTab('Templates'); openNewTemplate('tx'); }} />}

    {createCampaign ? <CampaignForm onClose={() => setCreateCampaign(false)} onDone={campaign => router.push(`/campaigns/${campaign.id}`)} /> : null}
    {templateModal ? <TemplateForm
      template={templateModal.template}
      defaultType={templateModal.defaultType}
      onClose={() => setTemplateModal(undefined)}
      onDone={message => {
        setTemplateModal(undefined);
        setNotice(message);
        templates.refresh();
      }}
    /> : null}
    {previewTemplate ? <TemplatePreviewModal template={previewTemplate} onClose={() => setPreviewTemplate(undefined)} /> : null}

    {deleteCampaignTarget ? <ConfirmDialog
      title="Delete newsletter"
      description={`Delete "${deleteCampaignTarget.name}" permanently? This action cannot be undone.`}
      actionLabel="Delete newsletter"
      busy={rowAction.busy}
      onClose={() => setDeleteCampaignTarget(undefined)}
      onConfirm={() => void rowAction.run(async () => {
        await api(`${path}/${deleteCampaignTarget.id}`, 'DELETE');
        setDeleteCampaignTarget(undefined);
        campaigns.refresh();
      }, 'Newsletter deleted.')}
    /> : null}

    {deleteTemplateTarget ? <ConfirmDialog
      title="Delete template"
      description={`Delete template "${deleteTemplateTarget.name}"? Newsletters referencing it will need another template before sending.`}
      actionLabel="Delete template"
      busy={rowAction.busy}
      onClose={() => setDeleteTemplateTarget(undefined)}
      onConfirm={() => void rowAction.run(async () => {
        await api(`/templates/${deleteTemplateTarget.id}`, 'DELETE');
        setDeleteTemplateTarget(undefined);
        templates.refresh();
      }, 'Template deleted.')}
    /> : null}
  </>;
}

function Preview({ id, onClose }: { id: number; onClose: () => void }) {
  const preview = useResource<string>(`${path}/${id}/preview`);
  const [device, setDevice] = useState('desktop');
  return <Modal title="Preview newsletter" onClose={onClose} size="large">
    <SegmentedControl label="Preview width" value={device} onChange={setDevice}>
      <SegmentedControlItem value="desktop" label="Desktop" />
      <SegmentedControlItem value="mobile" label="Mobile" />
    </SegmentedControl>
    {preview.data ? <iframe title="Newsletter preview" className={`ov-preview ${device === 'mobile' ? 'ov-preview--mobile' : ''}`} sandbox="" referrerPolicy="no-referrer" srcDoc={preview.data} />
      : <AsyncState loading={preview.loading} error={preview.error} retry={preview.refresh} />}
  </Modal>;
}

type DeliveryMode = 'test' | 'schedule' | 'send' | 'pause';

function DeliveryDialog({ mode, campaign, onClose, onDone }: {
  mode: DeliveryMode; campaign: Campaign; onClose: () => void; onDone: (notice: string) => void;
}) {
  const action = useAction();
  const [email, setEmail] = useState('');
  const [sendAt, setSendAt] = useState<ISODateTimeString>();
  const scheduled = campaign.status === 'scheduled';
  const copy = {
    test: { title: 'Send test email', endpoint: 'test', notice: 'Test email submitted to delivery.' },
    schedule: { title: 'Schedule newsletter', endpoint: 'schedule', notice: 'Newsletter scheduled.' },
    send: { title: campaign.status === 'paused' ? 'Resume sending' : 'Send newsletter', endpoint: 'start', notice: 'Delivery started.' },
    pause: scheduled ? { title: 'Cancel schedule', endpoint: 'pause', notice: 'Schedule cancelled. The newsletter is now a draft.' }
      : { title: 'Pause sending', endpoint: 'pause', notice: 'Delivery paused.' },
  }[mode];
  return <Modal title={copy.title} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        if (mode === 'schedule' && !sendAt) throw new Error('Choose a send date and time.');
        const body = mode === 'test' ? { email: email.trim() } : mode === 'schedule' ? { sendAt: new Date(sendAt!).toISOString() } : undefined;
        await api(`${path}/${campaign.id}/${copy.endpoint}`, 'POST', body);
        onDone(copy.notice);
      });
    }}>
      {mode === 'test' ? <TextInput label="Recipient email" type="email" description="Use an audience contact with recorded marketing consent." isRequired value={email} onChange={setEmail} /> : null}
      {mode === 'schedule' ? <DateTimeInput label="Send date and time" description="Uses your device's local timezone." isRequired value={sendAt} onChange={setSendAt} /> : null}
      {mode === 'send' ? <Text>Start sending <strong>{campaign.name}</strong> to eligible subscribers on its selected lists? Suppressed and unsubscribed addresses are excluded.</Text> : null}
      {mode === 'pause' ? <Text>{scheduled ? <>Return <strong>{campaign.name}</strong> to draft and cancel its scheduled send?</>
        : <>Pause delivery of <strong>{campaign.name}</strong>? Emails already submitted for delivery may still arrive.</>}</Text> : null}
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={mode === 'send' && campaign.status !== 'paused' ? 'Send now' : copy.title} isLoading={action.busy} />
      </FormActions>
    </form>
  </Modal>;
}

export function CampaignView({ id }: { id: string }) {
  const router = useRouter();
  const user = useUser();
  const canEdit = user.role !== 'analyst';
  const resource = useResource<Campaign>(`${path}/${id}`);
  const lists = useResource<MailingList[]>('/lists');
  const analytics = useResource<CampaignAnalytics>(`${path}/${id}/analytics`);
  const [modal, setModal] = useState<DeliveryMode | 'edit' | 'preview' | 'cancel' | 'delete'>();
  const [analyticsMetric, setAnalyticsMetric] = useState('views');
  const [exportingType, setExportingType] = useState<string>();
  const [notice, setNotice] = useState('');
  const action = useAction();
  const exporter = useAction();

  const campaign = resource.data;
  const running = useRunningCampaigns(campaign?.status === 'running');
  const liveStat = campaign ? running.items.find(item => item.id === campaign.id) : undefined;

  function finish(value: string) {
    setModal(undefined);
    setNotice(value);
    resource.refresh();
    analytics.refresh();
  }

  function refreshAll() {
    resource.refresh();
    analytics.refresh();
    running.refresh();
  }

  const series = analyticsMetric === 'clicks'
    ? analytics.data?.clicks
    : analyticsMetric === 'bounces'
      ? analytics.data?.bounces
      : analytics.data?.views;
  const seriesLabel = analyticsMetric === 'clicks' ? 'clicks' : analyticsMetric === 'bounces' ? 'bounces' : 'opens';
  const clickedLinks = (analytics.data?.links ?? []).map(item => ({ label: item.url, value: item.count }));

  return <>
    <PageHeader
      back={{ href: '/campaigns', label: 'Campaigns' }}
      title={campaign?.name || 'Newsletter'}
      description={campaign?.subject || 'Newsletter details and performance.'}
      actions={campaign && canEdit ? <>
        <Button label="Preview" icon={<Eye size={15} />} onClick={() => setModal('preview')} />
        <Button label="Send test" icon={<MailCheck size={15} />} onClick={() => setModal('test')} />
        {['draft', 'paused', 'scheduled'].includes(campaign.status) ? (
          <Button label="Schedule" icon={<Timer size={15} />} onClick={() => setModal('schedule')} />
        ) : null}
        {['draft', 'paused'].includes(campaign.status) ? (
          <Button variant="primary" icon={<Send size={15} />} label={campaign.status === 'paused' ? 'Resume' : 'Send newsletter'} onClick={() => setModal('send')} />
        ) : null}
        {campaign.status === 'running' || campaign.status === 'scheduled' ? (
          <Button icon={<Pause size={15} />} label={campaign.status === 'scheduled' ? 'Cancel schedule' : 'Pause'} onClick={() => setModal('pause')} />
        ) : null}
        {campaign.status === 'paused' || campaign.status === 'scheduled' ? (
          <Button icon={<Ban size={15} />} label="Cancel send" onClick={() => setModal('cancel')} />
        ) : null}
        <Button
          label="Clone"
          icon={<Copy size={15} />}
          isLoading={action.busy}
          onClick={() => void action.run(async () => {
            const cloned = await api<Campaign>(`${path}/${campaign.id}/clone`, 'POST');
            router.push(`/campaigns/${cloned.id}`);
          }, 'Newsletter cloned.')}
        />
        {campaign.status === 'draft' ? (
          <Button label="Edit" icon={<Pencil size={15} />} onClick={() => setModal('edit')} />
        ) : null}
        {canDeleteCampaign(campaign.status) ? (
          <Button variant="destructive" icon={<Trash2 size={15} />} label="Delete" onClick={() => setModal('delete')} />
        ) : null}
      </> : undefined}
    />

    {!campaign ? <Panel><AsyncState loading={resource.loading} error={resource.error} retry={resource.refresh} /></Panel> : <div className="ov-stack">
      <Feedback error={action.error || exporter.error} notice={notice || action.notice || exporter.notice} />

      {campaign.status === 'running' ? <Panel
        title="Sending in progress"
        description="Live delivery status updates automatically every few seconds."
        action={<Button size="sm" label="Refresh" icon={<RefreshCw size={14} />} onClick={refreshAll} />}
      >
        <SendProgress
          label={campaign.name}
          sent={liveStat?.sent ?? campaign.metrics.sent ?? 0}
          total={liveStat?.toSend ?? campaign.toSend ?? 0}
          rate={liveStat ? (liveStat.rate || liveStat.netRate) : undefined}
        />
      </Panel> : null}

      <Panel
        title="Email performance"
        action={<Button size="sm" label="Refresh metrics" icon={<RefreshCw size={14} />} onClick={refreshAll} isLoading={resource.loading || analytics.loading} />}
      >
        <EmailMetrics metrics={campaign.metrics} />
        {canEdit ? <div className="ov-actions">
          <Text type="label" color="secondary">Export CSV:</Text>
          {exportMetrics.map(item => <Button
            key={item.value}
            size="sm"
            icon={<Download size={14} />}
            label={item.label}
            isLoading={exporter.busy && exportingType === item.value}
            isDisabled={exporter.busy}
            onClick={() => {
              setExportingType(item.value);
              void exporter.run(async () => {
                const csv = await api<string>(`${path}/${campaign.id}/analytics/export?type=${item.value}`);
                saveFile(csv, `campaign-${campaign.id}-${item.value}.csv`, 'text/csv');
              }, `${item.label} exported.`);
            }}
          />)}
        </div> : null}
      </Panel>

      <div className="ov-grid">
        <Panel
          title="Campaign analytics"
          description="Tracked engagement over time"
          action={<SegmentedControl label="Campaign analytics metric" size="sm" value={analyticsMetric} onChange={setAnalyticsMetric}>
            <SegmentedControlItem value="views" label="Opens" />
            <SegmentedControlItem value="clicks" label="Clicks" />
            <SegmentedControlItem value="bounces" label="Bounces" />
          </SegmentedControl>}
        >
          {!analytics.data ? <AsyncState loading={analytics.loading} error={analytics.error} retry={analytics.refresh} />
            : <Bars points={series} label={`Newsletter ${seriesLabel} over time`} />}
        </Panel>

        <Panel
          title="Clicked links"
          description={clickedLinks.length ? `${number(clickedLinks.reduce((sum, item) => sum + item.value, 0))} tracked clicks across ${number(clickedLinks.length)} URL${clickedLinks.length === 1 ? '' : 's'}` : 'Destination URLs clicked by recipients.'}
        >
          {!analytics.data ? <AsyncState loading={analytics.loading} error={analytics.error} retry={analytics.refresh} />
            : clickedLinks.length ? <Distribution points={clickedLinks} />
              : <Empty title="No clicked links yet" description="Tracked link clicks appear here once recipients interact with this newsletter." />}
        </Panel>
      </div>

      <Panel title="Newsletter details" action={canEdit && campaign.status === 'draft' ? <Button size="sm" label="Edit newsletter" onClick={() => setModal('edit')} /> : undefined}>
        <MetadataList>
          <MetadataListItem label="Status"><Status status={campaign.status} /></MetadataListItem>
          <MetadataListItem label="From">{campaign.fromEmail || 'Configured sender'}</MetadataListItem>
          <MetadataListItem label="Format">{formatLabel(campaign.contentType)}</MetadataListItem>
          <MetadataListItem label="Mailing lists">{campaign.listIds.map(listId => lists.data?.find(list => list.id === listId)?.name || `List ${listId}`).join(', ') || '—'}</MetadataListItem>
          <MetadataListItem label="Tags">
            {campaign.tags?.length
              ? <span className="ov-tags">{campaign.tags.map(tag => <Token key={tag} label={tag} size="sm" />)}</span>
              : '—'}
          </MetadataListItem>
          <MetadataListItem label="Created">{date(campaign.createdAt)}</MetadataListItem>
          <MetadataListItem label="Send time">{date(campaign.sendAt)}</MetadataListItem>
          <MetadataListItem label="Total recipients">{number(campaign.toSend)}</MetadataListItem>
          <MetadataListItem label="Public archive">{campaign.archive ? 'Enabled' : 'Disabled'}</MetadataListItem>
        </MetadataList>
      </Panel>
    </div>}

    {campaign && modal === 'edit' ? <CampaignForm campaign={campaign} onClose={() => setModal(undefined)} onDone={() => finish('Changes saved.')} /> : null}
    {campaign && modal === 'preview' ? <Preview id={campaign.id} onClose={() => setModal(undefined)} /> : null}
    {campaign && modal === 'cancel' ? <ConfirmDialog
      title="Cancel newsletter delivery"
      description={`Permanently cancel "${campaign.name}"? Once cancelled, delivery cannot be resumed (you can still clone it into a new draft).`}
      actionLabel="Cancel delivery"
      busy={action.busy}
      onClose={() => setModal(undefined)}
      onConfirm={() => void action.run(async () => {
        await api(`${path}/${campaign.id}/cancel`, 'POST');
        finish('Newsletter delivery cancelled.');
      })}
    /> : null}
    {campaign && modal === 'delete' ? <ConfirmDialog
      title="Delete newsletter"
      description={`Permanently delete "${campaign.name}"? This action cannot be undone.`}
      actionLabel="Delete newsletter"
      busy={action.busy}
      onClose={() => setModal(undefined)}
      onConfirm={() => void action.run(async () => {
        await api(`${path}/${campaign.id}`, 'DELETE');
        router.push('/campaigns');
      }, 'Newsletter deleted.')}
    /> : null}
    {campaign && modal && modal !== 'preview' && modal !== 'edit' && modal !== 'cancel' && modal !== 'delete'
      ? <DeliveryDialog mode={modal} campaign={campaign} onClose={() => setModal(undefined)} onDone={finish} /> : null}
  </>;
}
