import { Container } from "inversify";
import { TYPES as CoreTypes } from "@mineskin/core";
import { billingModule } from "@mineskin/billing";
import { ApiLogProvider } from "./ApiLogProvider";
import { ApiAuditLogger } from "./ApiAuditLogger";
import {
    FlagsmithProvider,
    generatorModule,
    ImageService,
    MongoGeneratorClient,
    RedisProvider,
    TrafficService,
    TYPES as GeneratorTypes
} from "@mineskin/generator";

const container = new Container();
container.bind(CoreTypes.LogProvider).to(ApiLogProvider).inSingletonScope();
container.bind(CoreTypes.AuditLogger).to(ApiAuditLogger).inSingletonScope();
container.bind(CoreTypes.FlagProvider).to(FlagsmithProvider).inSingletonScope();
container.bind(CoreTypes.RedisProvider).to(RedisProvider).inSingletonScope();

container.load(billingModule);
container.load(generatorModule);

container.bind(GeneratorTypes.TrafficService).to(TrafficService).inSingletonScope();
container.bind(GeneratorTypes.GeneratorClient).to(MongoGeneratorClient).inSingletonScope();
container.bind(GeneratorTypes.ImageService).to(ImageService).inSingletonScope();

export { container };
