import sanitizeHtml from "sanitize-html";

const allowedTags = ["p", "div", "br", "h2", "span", "strong", "b", "em", "i", "u", "s", "strike", "ul", "ol", "li", "blockquote", "img"];

export function validateRichHtml(value) {
  const source = String(value ?? "");
  return sanitizeHtml(source, {
    allowedTags,
    allowedAttributes: { div: ["style", "class", "data-book-id", "contenteditable"], p: ["style"], span: ["style", "class", "contenteditable"], img: ["src", "alt", "style", "contenteditable"] },
    allowedSchemesByTag: { img: ["data"] },
    exclusiveFilter: (frame) => frame.tag === "img" && !String(frame.attribs?.src ?? "").startsWith("data:image/"),
    allowedClasses: { div: ["rich-image-frame", "rich-inline-book"], span: ["spoiler", "rich-image-resize-handle", "rich-inline-book-cover", "rich-inline-book-copy", "rich-inline-book-remove"] },
    allowedStyles: {
      "*": {
        "font-size": [/^(?:12|14|16|18|22|28)px$/],
        "text-align": [/^(?:left|right|center|justify)$/],
        "width": [/^\d{1,3}(?:\.\d+)?%$/],
        "max-width": [/^100%$/],
      },
    },
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
  });
}

export function plainTextFromHtml(value) {
  return sanitizeHtml(String(value ?? ""), {
    allowedTags: [],
    allowedAttributes: {},
    textFilter: (text) => text.replace(/\u00a0/g, " "),
  }).trim();
}
