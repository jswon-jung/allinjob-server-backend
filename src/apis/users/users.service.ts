import { User } from '@prisma/client';
import { CustomPrismaClient } from '../../database/prismaConfig';
import {
    IThermometerCreate,
    IThermometerDelete,
    IThermometerUser,
    ITopPercentage,
    IUserCreateDTO,
    IUserFindOneUserByID,
    IUserUpdateDTO,
} from './interfaces/user.interface';
import CustomError from '../../common/error/customError';
import { Service } from 'typedi';
import { FindUserKeywordDTO } from './dto/findUserKeyword.dto';
import { ElasitcClient } from '../../database/elasticConfig';
import { SaveInterestKeywordDTO } from './dto/saveInterestKeyword.dto';
import { ScrappingDTO } from './dto/scrapping.dto';
import { scrapData } from '../../common/util/scrap_data';
import { GetUserScrapDTO } from './dto/getUserScrap.dto';
import { ScrapType } from './types/scrap.type';
import { idType } from '../../common/types';
import { percentage } from '../../common/util/termometer';
import { PercentageType } from './types/thermometer.type';
import { languageTitle } from '../../common/util/languageData';
import { CrawlingService } from '../crawling/crawling.service';
import { getScrapId } from '../../common/util/getScrapId';

@Service()
export class UserService {
    constructor(
        private readonly prisma: CustomPrismaClient, //
        private readonly elastic: ElasitcClient,
        private readonly crawlingService: CrawlingService,
    ) {}

    async findUserKeyword({
        id,
        path,
        classify,
    }: FindUserKeywordDTO): Promise<string> {
        const result = await this.prisma.user.findUnique({
            where: {
                id,
            },
            select: {
                interests: {
                    include: {
                        interest: true,
                        keyword: true,
                    },
                },
            },
        });

        let keywords: string[] = [];

        result!.interests.forEach(
            (el) =>
                el.interest.interest === path &&
                keywords.push(el.keyword.keyword),
        );

        if (classify) {
            keywords = await Promise.all(
                keywords.map(async (test) => {
                    return this.elastic
                        .search({
                            index: path,
                            _source: 'test',
                            size: 1,
                            body: {
                                query: {
                                    bool: {
                                        must: [
                                            { match: { classify } },
                                            { match: { test } },
                                        ],
                                    },
                                },
                            },
                        })
                        .then((data) => {
                            const hits = data.body.hits.hits[0];
                            return hits && hits._source.test;
                        });
                }),
            );
        }

        return keywords.filter((el) => el).join(' ');
    }

    saveInterestKeyword({ prisma, interests, id }: SaveInterestKeywordDTO) {
        return Promise.all(
            interests.map(async (el) => {
                const [interest, keywords] = Object.entries(el)[0];
                const createdInterest = await prisma.interest.upsert({
                    where: { interest },
                    update: {},
                    create: { interest },
                });

                return Promise.all(
                    keywords.map(async (keyword: string) => {
                        const createdKeyword = await prisma.keyword.upsert({
                            where: { keyword },
                            update: {},
                            create: { keyword },
                        });
                        await prisma.userInterest.create({
                            data: {
                                userId: id,
                                interestId: createdInterest.id,
                                keywordId: createdKeyword.id,
                            },
                        });
                    }),
                );
            }),
        );
    }

    findOneUserByEmail(email: string): Promise<User | null> {
        return this.prisma.user.findUnique({
            where: {
                email,
            },
            include: {
                interests: {
                    include: {
                        interest: true,
                        keyword: true,
                    },
                },
                communities: true,
            },
        });
    }

    async isUserByID(id: string): Promise<User> {
        const isUser = await this.prisma.user.findUnique({
            where: {
                id,
            },
            include: {
                communities: true,
                interests: true,
            },
        });
        if (!isUser) {
            throw new CustomError('id가 일치하는 유저가 없습니다', 400);
        }
        return isUser;
    }

    async findUserProfile(id: string) {
        const profile = await this.prisma.user.findUnique({
            where: { id },
            select: {
                profileImage: true,
                nickname: true,
                interests: {
                    select: {
                        interest: { select: { interest: true } },
                        keyword: { select: { keyword: true } },
                    },
                },
            },
        });

        const interestKeyword = profile?.interests.reduce(
            (result: any, el: any) => {
                const existingGroup = result.find(
                    (group: any) => group.interest === el.interest.interest,
                );
                if (existingGroup)
                    existingGroup.keyword.push(el.keyword.keyword);
                else {
                    result.push({
                        interest: el.interest.interest,
                        keyword: [el.keyword.keyword],
                    });
                }
                return result;
            },
            [],
        );

        return {
            profileImage: profile?.profileImage,
            nickname: profile?.nickname,
            interestKeyword,
        };
    }

    async isNickname(nickname: string): Promise<boolean> {
        const isNickname = await this.prisma.user.findUnique({
            where: {
                nickname,
            },
        });
        if (isNickname)
            throw new CustomError('이미 사용중인 닉네임입니다', 400);
        else return true;
    }

    findOneUserByID({
        name,
        phone,
    }: IUserFindOneUserByID): Promise<{ email: string; provider: string }[]> {
        return this.prisma.user.findMany({
            where: {
                name,
                phone,
            },
            select: {
                email: true,
                provider: true,
            },
        });
    }

    async getLoginUserInfo(id: string) {
        const user = await this.isUserByID(id);
        const { nickname, profileImage, thermometer, top } = user;

        const major = await this.prisma.subMajor.findUnique({
            where: { id: user.subMajorId },
            select: {
                mainMajor: {
                    select: { mainMajor: true },
                },
            },
        });

        const solution = await this.crawlingService.randomCrawling();

        return {
            nickname,
            profileImage,
            thermometer,
            mainMajor: major!.mainMajor.mainMajor,
            top,
            solution,
        };
    }

    async createUser({ createDTO }: IUserCreateDTO): Promise<User['id']> {
        const { interests, major, ...userData } = createDTO;

        const { mainMajor, subMajor } = major;

        await this.isNickname(userData.nickname);

        return await this.prisma.$transaction(async (prisma) => {
            const isSubMajor = await prisma.subMajor.findFirst({
                where: { AND: [{ subMajor, mainMajor: { mainMajor } }] },
                select: { id: true },
            });
            const subMajorId = isSubMajor
                ? isSubMajor
                : await prisma.subMajor.create({
                      data: {
                          subMajor,
                          mainMajor: {
                              connectOrCreate: {
                                  where: { mainMajor },
                                  create: { mainMajor },
                              },
                          },
                      },
                      select: { id: true },
                  });

            const user = await prisma.user.create({
                data: {
                    ...userData,
                    subMajorId: subMajorId.id,
                },
            });
            await this.saveInterestKeyword({ prisma, interests, id: user.id });
            return user.id;
        });
    }

    async updateProfile({
        id,
        updateDTO,
    }: {
        id: string;
        updateDTO: IUserUpdateDTO;
    }): Promise<User> {
        const { interests, ...data } = updateDTO;

        const chkUser = await this.isUserByID(id);

        data.nickname && (await this.isNickname(data.nickname));

        if (interests) {
            await this.prisma.userInterest.deleteMany({
                where: { userId: id },
            });

            await this.prisma
                .$transaction(async (prisma) => {
                    await this.saveInterestKeyword({
                        prisma,
                        interests,
                        id: chkUser.id,
                    });
                })
                .then(async () => await this.isUserByID(id));
        }

        return await this.prisma.user.update({
            where: { id },
            data,
            include: {
                interests: {
                    include: {
                        interest: true,
                        keyword: true,
                    },
                },
            },
        });
    }

    async scrapping({
        id,
        path,
        scrapId,
    }: idType & ScrappingDTO): Promise<boolean> {
        await this.isUserByID(id);

        const chkScrap = await this.prisma.user.findFirst({
            include: {
                [scrapData(path).column]: {
                    where: {
                        AND: [{ userId: id, [scrapData(path).id]: scrapId }],
                    },
                },
            },
        });

        const chkPlusMinus = chkScrap?.[scrapData(path).column].length;
        const plusMinus = `ctx._source.scrap${chkPlusMinus ? '--' : '++'}`;

        await Promise.all([
            this.elastic
                .update(
                    {
                        index: path,
                        id: scrapId,
                        body: {
                            script: {
                                source: plusMinus,
                            },
                        },
                    },
                    { ignore: [404] },
                )
                .then((el) => el.body.error && el.meta.context),

            this.prisma.user.update({
                where: { id },
                data: {
                    [scrapData(path).column]: chkPlusMinus
                        ? {
                              deleteMany: { [scrapData(path).id]: scrapId },
                          }
                        : { create: { [scrapData(path).id]: scrapId } },
                },
            }),
        ]);

        return chkPlusMinus ? false : true;
    }

    async getUserScrap({
        id,
        ...data
    }: GetUserScrapDTO & { id: string }): Promise<ScrapType[]> {
        const { path, count, page } = data;
        await this.isUserByID(id);

        const _id = await getScrapId({ prisma: this.prisma, id, path });

        return await this.elastic
            .search({
                index: path,
                _source_includes: scrapData(path).info,
                body: {
                    sort:
                        path === 'language'
                            ? [
                                  {
                                      sortDate: {
                                          order: 'asc',
                                      },
                                  },
                              ]
                            : [{ view: { order: 'desc' } }],
                    query: {
                        terms: {
                            _id,
                        },
                    },
                    ...(page && { size: 4, from: (+page - 1 || 0) * 4 }),
                },
            })
            .then((data) => {
                return count
                    ? data.body.hits.total.value
                    : data.body.hits.hits.length
                    ? data.body.hits.hits.map((el: any) => {
                          if (path === 'language') {
                              const { test, ...data } = el._source;
                              return {
                                  id: el._id,
                                  enterprise: 'YBM',
                                  ...data,
                                  title: languageTitle(test),
                              };
                          }
                          if (path === 'qnet') {
                              const schedule = el._source.examSchedules[0];
                              delete el._source.examSchedules;
                              return {
                                  mainImage: process.env.QNET_IMAGE,
                                  id: el._id,
                                  period: schedule.wtPeriod,
                                  examDate: schedule.wtDday,
                                  ...el._source,
                              };
                          }
                          return {
                              id: el._id,
                              ...el._source,
                          };
                      })
                    : null;
            });
    }

    async delete(email: string): Promise<boolean> {
        const user = await this.findOneUserByEmail(email);
        const qqq = await this.prisma.user.delete({ where: { id: user?.id } });
        console.log(qqq);
        return true;
    }

    async updateThermometer({
        id,
        path,
        createThermometer,
        mainMajorId,
        thermometerId,
    }: IThermometerCreate & IThermometerDelete): Promise<boolean> {
        try {
            await this.isUserByID(id);

            const obj: { [key: string]: () => { column: string } } = {
                outside: () => ({ column: 'userOutside' }),
                intern: () => ({ column: 'userIntern' }),
                competition: () => ({ column: 'userCompetition' }),
                language: () => ({ column: 'userLanguage' }),
                qnet: () => ({ column: 'userQnet' }),
            };

            await this.prisma.$transaction(async (priusma) => {
                await this.prisma.user.update({
                    where: { id },
                    data: {
                        [obj[path]().column]: createThermometer
                            ? { create: { ...createThermometer } }
                            : { delete: { id: thermometerId } },
                    },
                });

                const { sum: thermometer } = await this.getCount(id);
                await this.prisma.user.update({
                    where: { id },
                    data: {
                        thermometer,
                    },
                });

                await this.topPercent({ id, mainMajorId });
                await this.updateTopPercentagesForAllUsers(mainMajorId);
            });
            return true;
        } catch (error) {
            console.error('transaction failed', error);
            return false;
        }
    }

    async getCount(id: string): Promise<PercentageType> {
        await this.isUserByID(id);

        const user = await this.prisma.user.findUnique({
            where: { id },
            select: {
                userCompetition: {
                    select: {
                        id: true,
                    },
                },
                userOutside: {
                    select: {
                        id: true,
                    },
                },
                userQnet: {
                    select: {
                        id: true,
                    },
                },
                userIntern: {
                    select: {
                        id: true,
                    },
                },
                userLanguage: {
                    select: {
                        id: true,
                    },
                },
            },
        });
        return percentage(user as IThermometerUser);
    }

    async topPercent({ id, mainMajorId }: ITopPercentage): Promise<User> {
        const top = await this.prisma.user.findMany({
            select: {
                id: true,
            },
            where: {
                subMajor: {
                    mainMajorId,
                },
            },
            orderBy: {
                thermometer: 'desc',
            },
        });

        const grade = top.findIndex((el) => el.id === id) + 1;

        const result = (grade / top.length) * 100;

        return await this.prisma.user.update({
            where: { id },
            data: {
                top: result,
            },
        });
    }

    async updateTopPercentagesForAllUsers(mainMajorId: string): Promise<void> {
        const users = await this.prisma.user.findMany({
            select: {
                id: true,
            },
        });

        for (const user of users) {
            const { top } = await this.topPercent({ id: user.id, mainMajorId });
            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    top,
                },
            });
        }
    }
}
