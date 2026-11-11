const test = require("node:test");
const assert = require("node:assert/strict");
const { suggestCategory } = require("../services/product-categories");

test("suggests a matching store category from the product name", () => {
  assert.deepEqual(suggestCategory("Logitech Wireless Mouse", ""), {
    category: "Peripherals", confidence: "high", matchedKeyword: "mouse",
  });
  assert.equal(suggestCategory("RTX graphics card", "Gaming GPU").category, "Components");
  assert.equal(suggestCategory("Wi-Fi 6 router", "Home networking").category, "Networking");
});

test("uses the description when the product name is not specific", () => {
  assert.equal(suggestCategory("Pro model", "1TB NVMe solid state storage").category, "Storage");
  assert.equal(suggestCategory("Office display", "27-inch IPS").category, "Monitors");
});

test("leaves unknown products for the store to classify manually", () => {
  assert.deepEqual(suggestCategory("Tech accessory", "General item"), {
    category: "", confidence: "none", matchedKeyword: "",
  });
});
