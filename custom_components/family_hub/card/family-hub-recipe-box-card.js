// This feature is intentionally excluded from the reduced fork.
class DisabledFamilyHubCard extends HTMLElement {
  setConfig() {
    this.textContent = "Recipe Box is disabled in this Family Hub version.";
  }
  set hass(value) {}
  getCardSize() { return 1; }
}
if (!customElements.get("family-hub-recipe-box-card")) customElements.define("family-hub-recipe-box-card", DisabledFamilyHubCard);
