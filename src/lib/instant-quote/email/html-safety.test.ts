import { describe, expect, it } from "vitest";
import { escapeHtml, sanitizeForEmailHeader } from "./html-safety";

describe("escapeHtml", () => {
  it("escapes &, <, >, \", '", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapes a script tag", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
  });

  it("escapes an inline bold tag inside address text", () => {
    expect(escapeHtml("123 <b>Main</b> St")).toBe("123 &lt;b&gt;Main&lt;/b&gt; St");
  });

  it("escapes ampersands and quotes together", () => {
    expect(escapeHtml('Tom & Jerry "Referral"')).toBe("Tom &amp; Jerry &quot;Referral&quot;");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeHtml("Jane Customer")).toBe("Jane Customer");
  });
});

describe("sanitizeForEmailHeader", () => {
  it("strips embedded CR/LF, replacing with a space", () => {
    expect(sanitizeForEmailHeader("Jane\r\nBcc: evil@example.com")).toBe("Jane Bcc: evil@example.com");
  });

  it("strips a bare LF", () => {
    expect(sanitizeForEmailHeader("Jane\nX-Injected: true")).toBe("Jane X-Injected: true");
  });

  it("strips a bare CR", () => {
    expect(sanitizeForEmailHeader("Jane\rX-Injected: true")).toBe("Jane X-Injected: true");
  });

  it("collapses multiple consecutive newlines to a single space", () => {
    expect(sanitizeForEmailHeader("Jane\r\n\r\n\r\nSmith")).toBe("Jane Smith");
  });

  it("leaves a normal name unchanged", () => {
    expect(sanitizeForEmailHeader("Jane Customer")).toBe("Jane Customer");
  });

  it("trims leading/trailing whitespace produced by a trailing newline", () => {
    expect(sanitizeForEmailHeader("Jane Customer\n")).toBe("Jane Customer");
  });
});
