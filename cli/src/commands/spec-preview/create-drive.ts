import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import {
  createPreviewDrive,
  findPreviewDriveByPreferredEditor,
  getPreviewAuthToken,
  resolveAppEditorId,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";
import { specPreviewCreateDriveMeta } from "./meta.js";

export const specPreviewCreateDrive = defineCommand({
  ...specPreviewCreateDriveMeta,
  execute: async (input, context) => {
    const base = await projectRoot(context.workdir);
    const { switchboardUrl } = resolvePreviewEndpoint(context.services, base);
    const appEditorId = resolveAppEditorId(base, input.app);
    const driveName = input.name ?? `${input.app} Preview`;
    const token = await getPreviewAuthToken(context.workdir, context.config);

    // Reuse by app (preferredEditor), not by name, so a different --name/--app
    // spelling doesn't spawn a duplicate drive for the same app.
    const existing = await findPreviewDriveByPreferredEditor(
      switchboardUrl,
      appEditorId,
      token,
    );
    if (existing) {
      return {
        text: `Preview drive "${existing.name}" already exists  id: ${existing.id}  preferredEditor: ${existing.preferredEditor ?? "(none)"}`,
        data: {
          projectPath: base,
          driveId: existing.id,
          preferredEditor: existing.preferredEditor,
        },
      };
    }

    const drive = await createPreviewDrive(
      switchboardUrl,
      driveName,
      appEditorId,
      token,
    );
    return {
      text: `Created preview drive "${drive.name}"  id: ${drive.id}  preferredEditor: ${drive.preferredEditor ?? "(none)"}`,
      data: {
        projectPath: base,
        driveId: drive.id,
        preferredEditor: drive.preferredEditor,
      },
    };
  },
});
