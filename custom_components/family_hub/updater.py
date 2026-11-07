"""The reduced fork is updated through reviewed HACS releases only."""

class UpdateError(Exception):
    """An uploaded integration update is not permitted."""

def decode_update_zip(zip_b64):
    raise UpdateError("ZIP installation is disabled. Use a reviewed release of this fork in HACS.")

def install_update_from_zip(integration_dir, zip_bytes, backup_root=None):
    raise UpdateError("ZIP installation is disabled. Use a reviewed release of this fork in HACS.")
