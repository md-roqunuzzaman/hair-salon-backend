import "dotenv/config";
import { contentModerationService } from "./app/module/contentModeration/contentModeration.service.js";

const testModeration = async () => {
  try {
    const result =
      await contentModerationService.moderateText("fuck you bitch");

    console.log("Moderation result:");
    console.log(result);
  } catch (error) {
    console.error("Moderation test failed:");
    console.error(error);
  }
};

testModeration();
