import { validate } from 'class-validator';
import CustomError from '../error/customError';
import { NextFunction, Request, Response } from 'express';
import { CreateCommunityDTO } from '../../apis/community/dto/create.input';
import { asyncHandler } from '../../middleware/async.handler';
import { FindOneCommunityDTO } from '../../apis/community/dto/findOneCommunity';
import { FindManyCommunityDTO } from '../../apis/community/dto/findManyCommunity';
import { idType, pathType } from '../types';
import { ToggleLikeCommunityDTO } from '../../apis/community/dto/toggleLikeCommunity';
import { CreateCommunityCommentDTO } from '../../apis/community/dto/create.comment.input';

class Validate {
    constructor() {
        this.createCommunity = asyncHandler(this.createCommunity.bind(this));
        this.findOneCommunity = asyncHandler(this.findOneCommunity.bind(this));
        this.findManyCommunity = asyncHandler(
            this.findManyCommunity.bind(this),
        );
    }

    async errors<T extends object>(dto: T) {
        const errors = await validate(dto);

        if (errors.length > 0) {
            const errorMessage = errors.map((error) => {
                const temp =
                    error.constraints && Object.values(error.constraints);
                return `${error.property} : ${temp}`;
            });

            throw new CustomError(errorMessage, 400);
        }
    }

    async createCommunity(req: Request, _: Response, next: NextFunction) {
        await this.errors(new CreateCommunityDTO(req.body));

        next();
    }

    async findManyCommunity(req: Request, _: Response, next: NextFunction) {
        const path = req.query.path as pathType;
        path && (await this.errors(new FindManyCommunityDTO(path)));

        next();
    }

    async findOneCommunity(req: Request, _: Response, next: NextFunction) {
        await this.errors(new FindOneCommunityDTO(req.params as idType));

        next();
    }

    async toggleLikeCommunity(req: Request, _: Response, next: NextFunction) {
        const { id: userId } = req.user as idType;
        const { id: communityId } = req.params as idType;
        await this.errors(new ToggleLikeCommunityDTO({ userId, communityId }));

        next();
    }
    async createCommunityComment(
        req: Request,
        _: Response,
        next: NextFunction,
    ) {
        const { id: userId } = req.user as idType;
        const { comment, id: communityId } = req.body;
        await this.errors(
            new CreateCommunityCommentDTO({ userId, communityId, comment }),
        );

        next();
    }
}
export default new Validate();

export const validateDTO = async <T extends object>(dto: T) => {
    const errors = await validate(dto);

    if (errors.length > 0) {
        const errorMessage = errors.map((error) => {
            const temp = error.constraints && Object.values(error.constraints);
            return `${error.property} : ${temp}`;
        });

        throw new CustomError(errorMessage, 400);
    }
};
