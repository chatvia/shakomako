/**
 * Inline form artifacts.
 *
 * The chat stream can carry a `form` tool artifact (built server-side by
 * RenderFormTool) — a fillable form the visitor submits mid-conversation. The
 * widget has no FormKit, so we map the server's FormKit schema nodes
 * (`$formkit` type + options/validation) to native inputs and POST the answers
 * to the widget form-submit endpoint.
 *
 * Security: every admin-authored label/option/value is set via textContent
 * (never innerHTML), so schema text can't inject markup. The block is built as
 * real DOM nodes on purpose — DOMPurify (markdown.ts) strips <form>/<input>.
 */
import { createElement } from './ui';
import { t } from './i18n';
import type { FormArtifact, FormSchemaNode } from './types';
import type { ChatWidget } from './widget';

/** A field's answer: text, a single checkbox's state, or the checked options. */
type FieldValue = string | boolean | string[];

interface FormField {
  name: string;
  wrapper: HTMLElement;
  getValue: () => FieldValue;
  validate: () => boolean;
}

/** The parts of a rendered form that submit() updates. */
interface FormElements {
  card: HTMLElement;
  submitBtn: HTMLButtonElement;
  errorEl: HTMLElement;
}

const TEXT_INPUTS: Record<string, string> = {
  text: 'text',
  email: 'email',
  tel: 'tel',
  number: 'number',
  date: 'date'
};

function isRequired(node: FormSchemaNode): boolean {
  return typeof node.validation === 'string' && node.validation.split('|').includes('required');
}

function successView(message: string | undefined): HTMLElement {
  const box = createElement('div', { className: 'chatvia-widget-form-success' });
  box.appendChild(
    createElement('span', { className: 'chatvia-widget-form-check', textContent: '✓' })
  );
  box.appendChild(createElement('span', { textContent: message || t('forms.success_default') }));
  return box;
}

function expiredView(): HTMLElement {
  return createElement('div', {
    className: 'chatvia-widget-form-expired',
    textContent: t('forms.expired')
  });
}

// Unique ids that tie each label and error message to its control.
let fieldCount = 0;

function optionRows(node: FormSchemaNode, inputType: 'radio' | 'checkbox'): HTMLElement {
  const group = createElement('div', { className: 'chatvia-widget-form-group', role: 'group' });
  for (const o of Array.isArray(node.options) ? node.options : []) {
    const row = createElement('label', { className: 'chatvia-widget-form-choice' });
    const input = createElement('input', { type: inputType, name: node.name });
    input.value = String(o.value ?? '');
    row.appendChild(input);
    row.appendChild(createElement('span', { textContent: String(o.label ?? o.value ?? '') }));
    group.appendChild(row);
  }
  return group;
}

/**
 * Build one field. Returns { name, wrapper, getValue, validate } or null.
 */
function buildField(node: FormSchemaNode): FormField | null {
  const type = String(node.$formkit || 'text');
  const name = String(node.name || '');
  if (!name) return null;

  const required = isRequired(node);
  const singleCheckbox = type === 'checkbox' && !node.multiple;
  const wrapper = createElement('div', { className: 'chatvia-widget-form-field' });
  const id = `chatvia-widget-form-field-${++fieldCount}`;

  // Single checkbox carries its label inline (next to the box), not above.
  // `for` names the control below (choice groups point back via aria-labelledby).
  if (node.label && !singleCheckbox) {
    const label = createElement('label', {
      className: 'chatvia-widget-form-label',
      id: `${id}-label`,
      for: id,
      textContent: node.label
    });
    if (required)
      label.appendChild(
        createElement('span', { className: 'chatvia-widget-form-req', textContent: ' *' })
      );
    wrapper.appendChild(label);
  }

  let getValue: () => FieldValue;
  // The element that carries the field's id and its invalid state.
  let control: HTMLElement;

  if (type === 'textarea') {
    const ta = createElement('textarea', {
      className: 'chatvia-widget-form-input',
      rows: '3',
      name
    });
    if (node.placeholder) ta.setAttribute('placeholder', node.placeholder);
    wrapper.appendChild(ta);
    getValue = () => ta.value.trim();
    control = ta;
  } else if (type === 'select') {
    const sel = createElement('select', { className: 'chatvia-widget-form-input', name });
    sel.appendChild(createElement('option', { value: '', textContent: node.placeholder || '—' }));
    for (const o of Array.isArray(node.options) ? node.options : []) {
      sel.appendChild(
        createElement('option', {
          value: String(o.value ?? ''),
          textContent: String(o.label ?? o.value ?? '')
        })
      );
    }
    wrapper.appendChild(sel);
    getValue = () => sel.value;
    control = sel;
  } else if (type === 'radio') {
    const group = optionRows(node, 'radio');
    wrapper.appendChild(group);
    getValue = () => group.querySelector<HTMLInputElement>('input:checked')?.value ?? '';
    control = group;
  } else if (type === 'checkbox' && node.multiple) {
    const group = optionRows(node, 'checkbox');
    wrapper.appendChild(group);
    getValue = () =>
      Array.from(group.querySelectorAll<HTMLInputElement>('input:checked')).map(c => c.value);
    control = group;
  } else if (singleCheckbox) {
    const row = createElement('label', { className: 'chatvia-widget-form-choice' });
    const box = createElement('input', { type: 'checkbox', name });
    row.appendChild(box);
    if (node.label) row.appendChild(createElement('span', { textContent: node.label }));
    wrapper.appendChild(row);
    getValue = () => box.checked;
    control = box;
  } else {
    const input = createElement('input', {
      type: TEXT_INPUTS[type] || 'text',
      name,
      className: 'chatvia-widget-form-input'
    });
    if (node.placeholder) input.setAttribute('placeholder', node.placeholder);
    wrapper.appendChild(input);
    getValue = () => input.value.trim();
    control = input;
  }

  control.id = id;
  if (control.getAttribute('role') === 'group' && node.label) {
    // A group isn't labelable with `for`; it names its label instead.
    wrapper.querySelector('.chatvia-widget-form-label')?.removeAttribute('for');
    control.setAttribute('aria-labelledby', `${id}-label`);
  }

  if (node.help) {
    wrapper.appendChild(
      createElement('div', { className: 'chatvia-widget-form-help', textContent: node.help })
    );
  }

  const errorEl = createElement('div', {
    className: 'chatvia-widget-form-field-error',
    id: `${id}-error`
  });
  errorEl.style.display = 'none';
  wrapper.appendChild(errorEl);
  control.setAttribute('aria-describedby', errorEl.id);

  function validate(): boolean {
    if (!required) return true;
    const v = getValue();
    const empty = v === '' || v === false || (Array.isArray(v) && v.length === 0);
    errorEl.textContent = empty ? t('forms.required') : '';
    control.setAttribute('aria-invalid', String(empty));
    errorEl.style.display = empty ? '' : 'none';
    return !empty;
  }

  return { name, wrapper, getValue, validate };
}

async function submit(
  widget: ChatWidget,
  form: FormArtifact,
  messageId: string | null | undefined,
  fields: Record<string, FieldValue>,
  els: FormElements
): Promise<void> {
  els.submitBtn.disabled = true;
  els.errorEl.style.display = 'none';
  const label = els.submitBtn.textContent;
  els.submitBtn.textContent = t('forms.submitting');

  try {
    const api = (await import('./api')).default;
    const response = await api({
      endpoint: `forms/${encodeURIComponent(form.form_instance_id)}/submit`,
      method: 'POST',
      headers: {
        'X-AGENT-ID': widget.agentId,
        'X-SESSION-ID': widget.sessionId,
        'X-CONVERSATION-ID': widget.getCurrentActiveConversationId()
      },
      body: JSON.stringify({ fields, assistant_message_id: messageId || null })
    });

    // 200 = submitted, 409 = already submitted (e.g. resubmit / reload) — both done.
    if (response.ok || response.status === 409) {
      let message = form.success_message;
      if (response.ok) {
        const data: { success_message?: string } = await response.json().catch(() => ({}));
        message = data.success_message || message;
      }
      els.card.replaceChildren(successView(message));
      _markStoredArtifactSubmitted(widget, messageId, form.form_instance_id);
      return;
    }

    if (response.status === 410) {
      els.card.replaceChildren(expiredView());
      return;
    }

    els.errorEl.textContent = t('forms.submit_failed');
    els.errorEl.style.display = '';
  } catch {
    els.errorEl.textContent = t('forms.submit_failed');
    els.errorEl.style.display = '';
  } finally {
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = label;
  }
}

/**
 * Flip the stored in-memory artifact to submitted so an in-session re-render
 * (conversation switch) shows the read-only state without a round trip. A page
 * reload reads the authoritative status from the server instead.
 */
function _markStoredArtifactSubmitted(
  widget: ChatWidget,
  messageId: string | null | undefined,
  instanceId: string
): void {
  const message = widget.messageHistory?.find(m => m.id === messageId);
  const artifacts = message?.metadata?.artifacts;
  if (!Array.isArray(artifacts)) return;
  for (const a of artifacts) {
    if (a?.kind === 'form' && a.data?.form_instance_id === instanceId) {
      a.data.status = 'submitted';
    }
  }
}

/**
 * Render an inline form artifact as a DOM node bound to one assistant message.
 *
 * @param form - the artifact `data` (form_instance_id, schema, …)
 * @param messageId - the assistant message this form belongs to
 */
export function createInlineForm(
  widget: ChatWidget,
  form: FormArtifact,
  messageId: string | null | undefined
): HTMLElement {
  const card = createElement('div', { className: 'chatvia-widget-form' });
  card.setAttribute('data-form-instance', form.form_instance_id || '');

  if (form.status === 'submitted') {
    card.appendChild(successView(form.success_message));
    return card;
  }
  if (form.status === 'expired') {
    card.appendChild(expiredView());
    return card;
  }

  // Title + optional subtitle, grouped in a header so they share a divider
  // above the fields (mirrors the dashboard's InlineFormBlock rendering).
  if (form.title || form.subtitle) {
    const header = createElement('div', { className: 'chatvia-widget-form-header' });
    if (form.title) {
      header.appendChild(
        createElement('div', { className: 'chatvia-widget-form-title', textContent: form.title })
      );
    }
    if (form.subtitle) {
      header.appendChild(
        createElement('div', {
          className: 'chatvia-widget-form-subtitle',
          textContent: form.subtitle
        })
      );
    }
    card.appendChild(header);
  }

  const formEl = createElement('form', { className: 'chatvia-widget-form-body' });
  const fields: FormField[] = [];
  for (const node of Array.isArray(form.schema) ? form.schema : []) {
    const field = buildField(node);
    if (field) {
      fields.push(field);
      formEl.appendChild(field.wrapper);
    }
  }

  const submitBtn = createElement('button', {
    type: 'submit',
    className: 'chatvia-widget-form-submit',
    textContent: form.submit_label || t('forms.submit')
  });
  formEl.appendChild(submitBtn);

  const errorEl = createElement('div', { className: 'chatvia-widget-form-error' });
  errorEl.style.display = 'none';
  formEl.appendChild(errorEl);

  formEl.addEventListener('submit', e => {
    e.preventDefault();
    let valid = true;
    for (const f of fields) {
      if (!f.validate()) valid = false;
    }
    if (!valid) return;

    const values: Record<string, FieldValue> = {};
    for (const f of fields) values[f.name] = f.getValue();
    submit(widget, form, messageId, values, { card, submitBtn, errorEl });
  });

  card.appendChild(formEl);
  return card;
}
