import sanitizeHtml from "sanitize-html";

const allowedTags = ["p", "div", "br", "span", "strong", "b", "em", "i", "u", "s", "strike", "ul", "ol", "li", "blockquote"];

export function validateRichHtml(value) {
  const source = String(value ?? "");
  return sanitizeHtml(source, {
    allowedTags,
    allowedAttributes: { div: ["style"], p: ["style"], span: ["style", "class"] },
    allowedClasses: { span: ["spoiler"] },
    allowedStyles: {
      "*": {
        "font-size": [/^(?:12|14|16|18|22|28)px$/],
        "text-align": [/^(?:left|right|center|justify)$/],
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
