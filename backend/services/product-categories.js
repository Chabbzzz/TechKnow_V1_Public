(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.techKnowProductCategories = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const rules = [
    ["Laptops", ["laptop", "notebook", "macbook", "chromebook", "ultrabook"]],
    ["Monitors", ["monitor", "display", "screen", "ips", "oled", "4k", "144hz"]],
    ["Keyboards", ["keyboard", "mechanical keyboard", "keycap", "keycaps"]],
    ["Networking", ["router", "switch", "ethernet", "wifi", "wi-fi", "network", "access point", "modem"]],
    ["Storage", ["ssd", "hard drive", "hdd", "nvme", "flash drive", "usb drive", "storage", "memory card"]],
    ["Components", ["cpu", "processor", "gpu", "graphics card", "motherboard", "ram", "memory", "power supply", "psu", "case", "cooler"]],
    ["Peripherals", ["mouse", "webcam", "headset", "headphones", "speaker", "microphone", "printer", "controller", "gamepad", "peripheral"]],
  ];

  function suggestCategory(name = "", description = "") {
    const text = `${name} ${description}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    if (!text.trim()) return { category: "", confidence: "none", matchedKeyword: "" };
    for (const [category, keywords] of rules) {
      const keyword = keywords.find(value => text.includes(value));
      if (keyword) return { category, confidence: "high", matchedKeyword: keyword };
    }
    return { category: "", confidence: "none", matchedKeyword: "" };
  }
  return { suggestCategory, categories: rules.map(([category]) => category) };
});
