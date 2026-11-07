// This feature is intentionally excluded from the reduced fork.
class DisabledFamilyHubCard extends HTMLElement {
  setConfig() {
    this.textContent = "Companion is disabled in this Family Hub version.";
  }
  set hass(value) {}
  getCardSize() { return 1; }
}
if (!customElements.get("family-hub-companion-card")) customElements.define("family-hub-companion-card", DisabledFamilyHubCard);
