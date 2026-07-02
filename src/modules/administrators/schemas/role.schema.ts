import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RoleDocument = HydratedDocument<Role>;

// Mirrors stayhopper/db/models/roles.js (collection: "roles")
@Schema({ collection: 'roles', timestamps: true })
export class Role {
  @Prop({ required: true })
  name: string;

  @Prop({ type: [String], default: [] })
  permissions: string[];
}

export const RoleSchema = SchemaFactory.createForClass(Role);
