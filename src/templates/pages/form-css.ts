// Base styles for OVELIO forms: published pages, hosted forms, embeds and the builder canvas share them. Page themes
// override the submit colour and focus ring through the kit (.ovf-submit rules in kit.ts).
export const formCss = `.ovf{display:grid;gap:14px;text-align:left;font:inherit;color:inherit}
.ovf-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ovf-field{display:grid;gap:6px;min-width:0}
.ovf label,.ovf legend{font-size:14px;font-weight:600}
.ovf-req{color:#b91c1c;margin-left:3px}
.ovf input:not([type=checkbox]):not([type=radio]),.ovf select,.ovf textarea{width:100%;box-sizing:border-box;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;font-size:15px;line-height:1.4;background:#fff;color:#0f172a;outline:none}
.ovf textarea{resize:vertical}
.ovf-group{border:0;margin:0;padding:0;display:grid;gap:8px}
.ovf-choice{display:flex;gap:10px;align-items:flex-start;font-weight:400!important;font-size:14px;line-height:1.45;cursor:pointer}
.ovf-choice input{margin-top:3px;width:16px;height:16px;flex:none}
.ovf-help{font-size:13px;color:#64748b;margin:0}
.ovf-error{font-size:13px;color:#b91c1c;margin:0}
.ovf-invalid input:not([type=checkbox]):not([type=radio]),.ovf-invalid select,.ovf-invalid textarea{border-color:#dc2626}
.ovf-hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}
.ovf-submit{padding:14px 20px;border:0;font:inherit;font-weight:700;font-size:16px;cursor:pointer;background:#2457d6;color:#fff;border-radius:8px;width:100%}
.ovf-submit[disabled]{opacity:.6;cursor:progress}
.ovf-status{margin:0;font-size:14px;min-height:1px}
.ovf-status--error{color:#b91c1c}
.ovf-success{padding:20px;border-radius:10px;background:#ecfdf5;color:#065f46;font-weight:600;line-height:1.5}
@media (max-width:480px){.ovf-row{grid-template-columns:1fr}}`;
