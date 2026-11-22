import type {
  Asset, AssetInput, Category, CategoryInput, DynamicContent, DynamicContentInput, FocusItem,
  FocusItemInput, LandingPage, LandingPageInput, MarketingReport, MarketingReportData, Webhook,
  WebhookInput,
} from '../../contracts';
import { UpstreamError } from '../upstream';
import {
  items, record, requiredId, service, toAsset, toCategory, toDynamicContent,
  toFocusItem, toLandingPage, toMarketingReportData, toWebhook, type ApiRecord,
} from './normalize';
import { requiredText, validHttpUrl, cleanTriggers, stripHash, focusType, focusStyle, focusStyleOptions } from './helpers';
import type { Client } from './client';

export function contentApi(client: Client) {
  const { focusOrigin, request, list, write, remove, reports } = client;
  return {
    async assets(): Promise<Asset[]> {
      return (await list('/assets', 'assets')).map(toAsset).sort((a, b) => a.title.localeCompare(b.title));
    },

    async createAsset(input: AssetInput): Promise<Asset> {
      const title = requiredText(input.title, 'Enter an asset title.');
      const remotePath = validHttpUrl(input.remotePath, 'Enter a valid HTTP or HTTPS asset URL.');
      try {
        return toAsset(await write('/assets/new', 'asset', 'POST', {
          title,
          description: input.description ?? '',
          storageLocation: 'remote',
          file: remotePath,
          isPublished: input.published ?? true,
        }));
      } catch (error) {
        if (error instanceof UpstreamError && error.status === 400) {
          throw new UpstreamError(service, 400, 'Enter a reachable HTTP or HTTPS file URL so its file type can be verified.');
        }
        throw error;
      }
    },

    async updateAsset(id: number, input: Partial<AssetInput>): Promise<Asset> {
      const payload: ApiRecord = {};
      if (input.title !== undefined) payload.title = requiredText(input.title, 'Enter an asset title.');
      if (input.description !== undefined) payload.description = input.description;
      if (input.remotePath !== undefined) {
        payload.storageLocation = 'remote';
        payload.file = validHttpUrl(input.remotePath, 'Enter a valid HTTP or HTTPS asset URL.');
      }
      if (input.published !== undefined) payload.isPublished = input.published;
      try {
        return toAsset(await write(`/assets/${requiredId(id)}/edit`, 'asset', 'PATCH', payload));
      } catch (error) {
        if (error instanceof UpstreamError && error.status === 400) {
          throw new UpstreamError(service, 400, 'Enter a reachable HTTP or HTTPS file URL so its file type can be verified.');
        }
        throw error;
      }
    },

    async deleteAsset(id: number): Promise<void> {
      await remove(`/assets/${requiredId(id)}/delete`);
    },

    async pages(): Promise<LandingPage[]> {
      return (await list('/pages', 'pages')).map(toLandingPage).sort((a, b) => a.title.localeCompare(b.title));
    },

    async createPage(input: LandingPageInput): Promise<LandingPage> {
      const title = requiredText(input.title, 'Enter a landing page title.');
      return toLandingPage(await write('/pages/new', 'page', 'POST', {
        title,
        ...(input.alias !== undefined ? { alias: input.alias } : {}),
        metaDescription: input.metaDescription ?? '',
        customHtml: input.customHtml,
        template: 'blank',
        isPublished: input.published ?? true,
      }));
    },

    async updatePage(id: number, input: Partial<LandingPageInput>): Promise<LandingPage> {
      const payload: ApiRecord = {};
      if (input.title !== undefined) payload.title = requiredText(input.title, 'Enter a landing page title.');
      if (input.alias !== undefined) payload.alias = input.alias;
      if (input.metaDescription !== undefined) payload.metaDescription = input.metaDescription;
      if (input.customHtml !== undefined) payload.customHtml = input.customHtml;
      if (input.published !== undefined) payload.isPublished = input.published;
      return toLandingPage(await write(`/pages/${requiredId(id)}/edit`, 'page', 'PATCH', payload));
    },

    async deletePage(id: number): Promise<void> {
      await remove(`/pages/${requiredId(id)}/delete`);
    },

    async webhooks(): Promise<Webhook[]> {
      return (await list('/hooks', 'hooks')).map(toWebhook).sort((a, b) => a.name.localeCompare(b.name));
    },

    async webhookTriggers(): Promise<Record<string, unknown>> {
      const response = await request('/hooks/triggers');
      return record(response.triggers ?? response);
    },

    async createWebhook(input: WebhookInput): Promise<Webhook> {
      const name = requiredText(input.name, 'Enter a webhook name.');
      const webhookUrl = validHttpUrl(input.webhookUrl, 'Enter a valid HTTP or HTTPS webhook URL.');
      const triggers = cleanTriggers(input.triggers);
      return toWebhook(await write('/hooks/new', 'hook', 'POST', {
        name,
        description: input.description ?? '',
        webhookUrl,
        triggers,
        isPublished: input.published ?? true,
      }));
    },

    async updateWebhook(id: number, input: Partial<WebhookInput>): Promise<Webhook> {
      const payload: ApiRecord = {};
      if (input.name !== undefined) payload.name = requiredText(input.name, 'Enter a webhook name.');
      if (input.description !== undefined) payload.description = input.description;
      if (input.webhookUrl !== undefined) payload.webhookUrl = validHttpUrl(input.webhookUrl, 'Enter a valid HTTP or HTTPS webhook URL.');
      if (input.triggers !== undefined) payload.triggers = cleanTriggers(input.triggers);
      if (input.published !== undefined) payload.isPublished = input.published;
      return toWebhook(await write(`/hooks/${requiredId(id)}/edit`, 'hook', 'PATCH', payload));
    },

    async deleteWebhook(id: number): Promise<void> {
      await remove(`/hooks/${requiredId(id)}/delete`);
    },

    async categories(bundle?: string): Promise<Category[]> {
      const response = await request('/categories?limit=100');
      const target = bundle?.trim();
      return items(response.categories)
        .map(toCategory)
        .filter(category => !target || category.bundle === target)
        .sort((a, b) => a.title.localeCompare(b.title));
    },

    async createCategory(input: CategoryInput): Promise<Category> {
      const title = requiredText(input.title, 'Enter a category title.');
      const bundle = requiredText(input.bundle, 'Select a category bundle.');
      const color = stripHash(input.color ?? '') || '2457d6';
      return toCategory(await write('/categories/new', 'category', 'POST', {
        title,
        bundle,
        description: input.description ?? '',
        color,
        isPublished: input.published ?? true,
      }));
    },

    async updateCategory(id: number, input: Partial<CategoryInput>): Promise<Category> {
      const payload: ApiRecord = {};
      if (input.title !== undefined) payload.title = requiredText(input.title, 'Enter a category title.');
      if (input.bundle !== undefined) payload.bundle = requiredText(input.bundle, 'Select a category bundle.');
      if (input.description !== undefined) payload.description = input.description;
      if (input.color !== undefined) payload.color = stripHash(input.color);
      if (input.published !== undefined) payload.isPublished = input.published;
      return toCategory(await write(`/categories/${requiredId(id)}/edit`, 'category', 'PATCH', payload));
    },

    async deleteCategory(id: number): Promise<void> {
      await remove(`/categories/${requiredId(id)}/delete`);
    },

    async dynamicContents(): Promise<DynamicContent[]> {
      const response = await request('/dynamiccontents?limit=100');
      return items(response.dynamicContents)
        .map(toDynamicContent)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async createDynamicContent(input: DynamicContentInput): Promise<DynamicContent> {
      const name = requiredText(input.name, 'Enter a dynamic content name.');
      const slotName = requiredText(input.slotName, 'Enter a dynamic content slot name.');
      return toDynamicContent(await write('/dynamiccontents/new', 'dynamicContent', 'POST', {
        name,
        slotName,
        content: input.content,
        isCampaignBased: input.isCampaignBased ?? true,
        isPublished: input.published ?? true,
      }));
    },

    async updateDynamicContent(id: number, input: Partial<DynamicContentInput>): Promise<DynamicContent> {
      const payload: ApiRecord = {};
      if (input.name !== undefined) payload.name = requiredText(input.name, 'Enter a dynamic content name.');
      if (input.slotName !== undefined) payload.slotName = requiredText(input.slotName, 'Enter a dynamic content slot name.');
      if (input.content !== undefined) payload.content = input.content;
      if (input.isCampaignBased !== undefined) payload.isCampaignBased = input.isCampaignBased;
      if (input.published !== undefined) payload.isPublished = input.published;
      return toDynamicContent(await write(`/dynamiccontents/${requiredId(id)}/edit`, 'dynamicContent', 'PATCH', payload));
    },

    async deleteDynamicContent(id: number): Promise<void> {
      await remove(`/dynamiccontents/${requiredId(id)}/delete`);
    },

    async focusItems(): Promise<FocusItem[]> {
      const response = await request('/focus?limit=100');
      const origin = focusOrigin();
      return items(response.focus)
        .map(entry => toFocusItem(entry, origin))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async createFocusItem(input: FocusItemInput): Promise<FocusItem> {
      const name = requiredText(input.name, 'Enter a focus item name.');
      const type = focusType(input.type);
      const style = focusStyle(input.style);
      return toFocusItem(await write('/focus/new', 'focus', 'POST', {
        name,
        description: input.description ?? '',
        type,
        style,
        htmlMode: 'basic',
        ...(type === 'form' && input.formId ? { form: requiredId(input.formId) } : {}),
        isPublished: input.published ?? true,
        properties: {
          animate: 1,
          when: input.when ?? 'immediately',
          [style]: focusStyleOptions(style),
          content: {
            headline: input.headline ?? name,
            tagline: input.tagline ?? '',
            link_text: input.linkText ?? '',
            link_url: input.linkUrl ?? '',
            link_new_window: 0,
          },
          colors: {
            primary: stripHash(input.primaryColor ?? '2457d6') || '2457d6',
            text: stripHash(input.textColor ?? '111827') || '111827',
            button: stripHash(input.buttonColor ?? '2457d6') || '2457d6',
            button_text: stripHash(input.buttonTextColor ?? 'ffffff') || 'ffffff',
          },
        },
      }), focusOrigin());
    },

    async updateFocusItem(id: number, input: Partial<FocusItemInput>): Promise<FocusItem> {
      const payload: ApiRecord = {};
      const properties: ApiRecord = {};
      if (input.name !== undefined) payload.name = requiredText(input.name, 'Enter a focus item name.');
      if (input.description !== undefined) payload.description = input.description;
      if (input.type !== undefined) payload.type = focusType(input.type);
      if (input.style !== undefined) {
        const style = focusStyle(input.style);
        payload.style = style;
        properties[style] = focusStyleOptions(style);
      }
      if (input.formId !== undefined) payload.form = input.formId === null ? null : requiredId(input.formId);
      if (input.published !== undefined) payload.isPublished = input.published;
      if (input.when !== undefined) properties.when = input.when;

      const content: ApiRecord = {};
      if (input.headline !== undefined) content.headline = input.headline;
      if (input.tagline !== undefined) content.tagline = input.tagline;
      if (input.linkText !== undefined) content.link_text = input.linkText;
      if (input.linkUrl !== undefined) content.link_url = input.linkUrl;
      if (Object.keys(content).length) properties.content = content;

      const colors: ApiRecord = {};
      if (input.primaryColor !== undefined) colors.primary = stripHash(input.primaryColor);
      if (input.textColor !== undefined) colors.text = stripHash(input.textColor);
      if (input.buttonColor !== undefined) colors.button = stripHash(input.buttonColor);
      if (input.buttonTextColor !== undefined) colors.button_text = stripHash(input.buttonTextColor);
      if (Object.keys(colors).length) properties.colors = colors;

      if (Object.keys(properties).length) payload.properties = properties;
      return toFocusItem(await write(`/focus/${requiredId(id)}/edit`, 'focus', 'PATCH', payload), focusOrigin());
    },

    async deleteFocusItem(id: number): Promise<void> {
      await remove(`/focus/${requiredId(id)}/delete`);
    },

    reports,

    async report(id: number, limit = 50): Promise<MarketingReportData> {
      const reportId = requiredId(id);
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new UpstreamError(service, 400, 'Choose a valid report row limit.');
      }
      const [response, allReports] = await Promise.all([
        request(`/reports/${reportId}?limit=${limit}`),
        reports().catch(() => [] as MarketingReport[]),
      ]);
      const meta = allReports.find(entry => entry.id === reportId);
      return toMarketingReportData(response, reportId, meta);
    },
  };
}
