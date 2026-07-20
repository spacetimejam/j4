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

test('renders headings clamped to h3..h6', () => {
  assert.equal(renderMarkdown('# One'), '<h3>One</h3>');
  assert.equal(renderMarkdown('## Two'), '<h4>Two</h4>');
  assert.equal(renderMarkdown('### Three'), '<h5>Three</h5>');
  assert.equal(renderMarkdown('#### Four'), '<h6>Four</h6>');
  assert.equal(renderMarkdown('###### Six'), '<h6>Six</h6>');
});

test('renders a bullet list', () => {
  assert.equal(renderMarkdown('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  assert.equal(renderMarkdown('* one\n* two'), '<ul><li>one</li><li>two</li></ul>');
});

test('renders an ordered list', () => {
  assert.equal(renderMarkdown('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
});

test('formats inline markup inside list items', () => {
  assert.equal(renderMarkdown('- a **b**'), '<ul><li>a <strong>b</strong></li></ul>');
});

test('renders a blockquote', () => {
  assert.equal(renderMarkdown('> quoted'), '<blockquote>quoted</blockquote>');
});

test('renders a horizontal rule', () => {
  assert.equal(renderMarkdown('---'), '<hr>');
  assert.equal(renderMarkdown('***'), '<hr>');
});

test('renders a fenced code block without parsing its contents', () => {
  assert.equal(renderMarkdown('```\na **b**\n```'),
    '<pre><code>a **b**</code></pre>');
});

test('ignores the language tag on a fence', () => {
  assert.equal(renderMarkdown('```js\nlet x = 1;\n```'),
    '<pre><code>let x = 1;</code></pre>');
});

test('escapes HTML inside a fenced code block', () => {
  const html = renderMarkdown('```\n<script>alert(1)</script>\n```');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('keeps a paragraph separate from a following list', () => {
  assert.equal(renderMarkdown('Intro:\n- one'), '<p>Intro:</p><ul><li>one</li></ul>');
});

test('handles an unterminated fenced code block', () => {
  assert.equal(renderMarkdown('```\n<script>alert(1)</script>'),
    '<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>');
});

test('ends a paragraph at a following heading, blockquote, rule or fence', () => {
  assert.equal(renderMarkdown('text\n# Head'), '<p>text</p><h3>Head</h3>');
  assert.equal(renderMarkdown('text\n> quote'), '<p>text</p><blockquote>quote</blockquote>');
  assert.equal(renderMarkdown('text\n---'), '<p>text</p><hr>');
  assert.equal(renderMarkdown('text\n```\ncode\n```'), '<p>text</p><pre><code>code</code></pre>');
});
