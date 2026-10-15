import * as assert from 'node:assert/strict';
import { DEFAULT_SEARCH_URL, MAX_QUERY, webSearchUrl } from '../../src/webSearch';

describe('webSearchUrl', () => {
  it('searches Google by default, with the text encoded', () => {
    assert.equal(webSearchUrl('', 'AT&T  and\nC++ #1?'), 'https://www.google.com/search?q=AT%26T%20and%20C%2B%2B%20%231%3F');
    assert.equal(DEFAULT_SEARCH_URL, 'https://www.google.com/search?q=%s');
  });

  it('puts the text where %s is, every time', () => {
    assert.equal(webSearchUrl('https://duckduckgo.com/?q=%s', 'città'), 'https://duckduckgo.com/?q=citt%C3%A0');
    assert.equal(webSearchUrl(' https://example.com/%s?q=%s ', 'a b'), 'https://example.com/a%20b?q=a%20b');
  });

  it('appends the text when there is no %s', () => {
    assert.equal(webSearchUrl('https://www.bing.com/search?q=', 'markdown'), 'https://www.bing.com/search?q=markdown');
  });

  it('falls back to Google for anything but a web address', () => {
    for (const template of ['javascript:alert(%s)', 'file:///etc/%s', 'command:workbench.action.quit', 'google', 'https://']) {
      assert.equal(webSearchUrl(template, 'x'), 'https://www.google.com/search?q=x', template);
    }
  });

  it('has nothing to search without text', () => {
    assert.equal(webSearchUrl('', ' \n\t '), undefined);
  });

  it('bounds the query, never cutting a character in half', () => {
    assert.equal(webSearchUrl('https://s.example/?q=', 'a'.repeat(2000)), `https://s.example/?q=${'a'.repeat(MAX_QUERY)}`);
    const emoji = `${'a'.repeat(MAX_QUERY - 1)}😀`;
    assert.equal(webSearchUrl('https://s.example/?q=', emoji), `https://s.example/?q=${'a'.repeat(MAX_QUERY - 1)}`);
  });
});
