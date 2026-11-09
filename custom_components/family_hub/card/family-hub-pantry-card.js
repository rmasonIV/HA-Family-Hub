// This feature is intentionally excluded from the reduced fork.
class DisabledFamilyHubCard extends HTMLElement {
  setConfig() {
    this.textContent = "Grocy Pantry is disabled in this Family Hub version.";
  }
  set hass(value) {}
  getCardSize() { return 1; }
}
if (!customElements.get("family-hub-pantry-card")) customElements.define("family-hub-pantry-card", DisabledFamilyHubCard);
