import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./User.js";
import { Threads } from "./Threads.js";
import { ThreadMessages } from "./ThreadMessages.js";

@Entity({ name: "ai_agent_feedbacks" })
export class AiAgentFeedback {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "text" })
  feedback!: string;

  @Column({ type: "int", name: "thread_id" })
  thread_id!: number;

  @ManyToOne(() => Threads, { onDelete: "CASCADE" })
  @JoinColumn({ name: "thread_id" })
  thread?: Threads;

  @Column({ type: "int", name: "thread_message_id" })
  thread_message_id!: number;

  @ManyToOne(() => ThreadMessages, { onDelete: "CASCADE" })
  @JoinColumn({ name: "thread_message_id" })
  thread_message?: ThreadMessages;

  @Column({ type: "int", name: "user_id" })
  user_id!: number;

  @ManyToOne(() => User, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "user_id" })
  user?: User;

  @Column({ type: "varchar", length: 64 })
  context!: string;

  @Column({ type: "boolean", default: false })
  analyzed!: boolean;

  @Column({ type: "boolean", default: false })
  resolved!: boolean;

  @CreateDateColumn({ type: "timestamptz", name: "created_at" })
  created_at!: Date;
}
