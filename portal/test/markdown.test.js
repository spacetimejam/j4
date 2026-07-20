import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/markdown.js';

test('wraps plain text in a paragraph', () => {
  assert.equal(renderMarkdown('Hello there'), '<p>Hello there</p>');
});

test('separates paragraphs on a blank line', () => {
  assert.equal(renderMarkdown('One\n\nTwo'), '<p>One</p><p>Two</p>');
});

test('turns a single newline into a soft break', () => {
  assert.equal(renderMarkdown('One\nTwo'), '<p>One<br>Two</p>');
});

test('renders bold and italic', () => {
  assert.equal(renderMarkdown('a **b** c'), '<p>a <strong>b</strong> c</p>');
  assert.equal(renderMarkdown('a __b__ c'), '<p>a <strong>b</strong> c</p>');
  assert.equal(renderMarkdown('a *b* c'), '<p>a <em>b</em> c</p>');
  assert.equal(renderMarkdown('a _b_ c'), '<p>a <em>b</em> c</p>');
});

test('leaves snake_case words alone', () => {
  assert.equal(renderMarkdown('some_var_name here'), '<p>some_var_name here</p>');
});

test('renders inline code without parsing its contents', () => {
  assert.equal(renderMarkdown('use `a **b** c` now'),
    '<p>use <code>a **b** c</code> now</p>');
});

test('renders a safe link', () => {
  assert.equal(renderMarkdown('[site](https://example.com)'),
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a></p>');
});

test('renders a mailto link', () => {
  assert.equal(renderMarkdown('[mail](mailto:a@b.com)'),
    '<p><a href="mailto:a@b.com" target="_blank" rel="noopener noreferrer">mail</a></p>');
});

test('refuses a javascript: link and renders it literally', () => {
  const html = renderMarkdown('[x](javascript:alert(1))');
  assert.ok(!html.includes('href'));
  assert.ok(html.includes('[x](javascript:alert(1))'));
});

test('escapes raw HTML so no live tag survives', () => {
  const html = renderMarkdown('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('escapes an img onerror payload', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

test('escapes HTML inside inline code', () => {
  assert.equal(renderMarkdown('`<b>hi</b>`'), '<p><code>&lt;b&gt;hi&lt;/b&gt;</code></p>');
});

test('handles empty and nullish input', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
});

test('does not let a code span leak into a link href', () => {
  const html = renderMarkdown('[x](https://a.com/`code`)');
  assert.ok(!html.includes('<a href'), 'must not produce an anchor');
  assert.ok(!/href="[^"]*<code>/.test(html), 'must not put a code element in an href');
});
