// The OVELIO email template gallery: 24 editable MJML templates, three in each category.
import type { EmailTemplateSummary } from '@/contracts/studio';
import { campaignTemplates } from './campaigns';
import { newsletterTemplates } from './newsletters';
import type { EmailTemplate } from './shared';

export type { EmailTemplate } from './shared';

export const emailTemplates: EmailTemplate[] = [...newsletterTemplates, ...campaignTemplates];

export function findTemplate(key: string): EmailTemplate | undefined {
  return emailTemplates.find(item => item.key === key);
}

export function templateSummary(template: EmailTemplate): EmailTemplateSummary {
  const { mjml: _mjml, ...summary } = template;
  void _mjml;
  return summary;
}
